import { useEffect, useReducer, useRef, useState } from 'react'
import type { FederationRemoteHint } from '../../shared/protocol.js'
import {
  emptyAudit,
  ingestRaw,
  dropProject,
  type AuditState,
  type ProjectEntry,
} from './assembler.js'
import { watchManifests } from './network-watcher.js'
import { fetchManifest, resolveManifestUrl } from './manifest-fetcher.js'
import type {
  CandidateEntry,
  DeepImportBypassEntry,
  EagerRiskEntry,
  FederationReport,
  MismatchedEntry,
  ProjectManifest,
  ProjectReport,
  RiskScore,
  SingletonRiskEntry,
  UnusedEntry,
} from '@mf-toolkit/shared-inspector/browser'

type Action =
  | { type: 'ingest'; raw: unknown; source?: string }
  | { type: 'drop'; name: string }
  | { type: 'reset' }

function reducer(state: AuditState, action: Action): AuditState {
  switch (action.type) {
    case 'ingest':
      return ingestRaw(state, action.raw, action.source)
    case 'drop':
      return dropProject(state, action.name)
    case 'reset':
      return emptyAudit
  }
}

/** Shape of what we persist per origin — manifest + source only; reports
 *  and scores are recomputed from the manifest on hydrate. */
interface PersistedEntry {
  manifest: ProjectManifest
  source?: string
}

const STORAGE_KEY_PREFIX = 'mf-audit:'

function storageKey(origin: string): string {
  return `${STORAGE_KEY_PREFIX}${origin}`
}

export interface AuditTabProps {
  /**
   * Federation hints accumulated from the page-world `__FEDERATION__` poller.
   * The tab reacts to additions by fetching the corresponding mf-manifest.json.
   */
  federationHints: FederationRemoteHint[]
}

export function AuditTab({ federationHints }: AuditTabProps): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, emptyAudit)
  const fetchedUrlsRef = useRef<Set<string>>(new Set())
  // Persist-cycle state. `origin` identifies the inspected page so two
  // different sites don't share manifests. `hydrated` gates the save effect
  // until the initial load has completed, otherwise we'd overwrite stored
  // data with the empty initial state on first render.
  const [origin, setOrigin] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // Resolve the inspected window's origin once. Used as the storage key so
  // the audit is per-site, not per-tab (tab IDs reshuffle on close/reopen).
  useEffect(() => {
    chrome.devtools.inspectedWindow.eval<string>(
      'location.origin',
      (result, exception) => {
        if (exception || typeof result !== 'string' || !result) {
          // chrome:// pages, file:// without permission, evaluation error —
          // skip persistence rather than fail loud.
          setHydrated(true)
          return
        }
        setOrigin(result)
      },
    )
  }, [])

  // Hydrate from storage once we know the origin.
  useEffect(() => {
    if (!origin || hydrated) return
    const key = storageKey(origin)
    void chrome.storage.local.get(key).then((result) => {
      const stored = (result[key] as PersistedEntry[] | undefined) ?? []
      for (const entry of stored) {
        dispatch({ type: 'ingest', raw: entry.manifest, source: entry.source })
      }
      setHydrated(true)
    }).catch(() => {
      setHydrated(true)
    })
  }, [origin, hydrated])

  // Persist after hydrate. Writing in `state.projects` change picks up both
  // ingestions and drops; we strip reports/scores since they're derivable.
  useEffect(() => {
    if (!origin || !hydrated) return
    const key = storageKey(origin)
    const entries: PersistedEntry[] = state.projects.map((p) => ({
      manifest: p.manifest,
      source: p.source,
    }))
    void chrome.storage.local.set({ [key]: entries }).catch(() => {})
  }, [origin, hydrated, state.projects])

  // Subscribe to live manifest fetches the page makes after DevTools is open.
  useEffect(() => {
    const unsubscribe = watchManifests(({ url, raw }) => {
      if (fetchedUrlsRef.current.has(url)) return
      fetchedUrlsRef.current.add(url)
      dispatch({ type: 'ingest', raw, source: url })
    })
    return unsubscribe
  }, [])

  // Pull manifests for federation hints that the network watcher missed
  // (loaded before DevTools opened). Idempotent — fetched URLs are tracked.
  useEffect(() => {
    const ctrl = new AbortController()
    void (async () => {
      for (const hint of federationHints) {
        if (ctrl.signal.aborted) return
        const url = resolveManifestUrl(hint)
        if (!url || fetchedUrlsRef.current.has(url)) continue
        fetchedUrlsRef.current.add(url)
        const result = await fetchManifest(url, ctrl.signal)
        if (ctrl.signal.aborted) return
        if (result) dispatch({ type: 'ingest', raw: result.raw, source: result.url })
      }
    })()
    return () => ctrl.abort()
  }, [federationHints])

  const onUpload = (raw: unknown, source: string): void => {
    dispatch({ type: 'ingest', raw, source })
  }

  return (
    <div className="audit">
      <div className="audit-head">
        <button
          className="help-btn"
          onClick={() => setHelpOpen(true)}
          title="How does Shared Audit work? (MF 2.0 vs classic Webpack flow, what each section means, persistence)"
          aria-label="Help"
        >
          ?
        </button>
      </div>
      {helpOpen && <AuditHelpPopover onClose={() => setHelpOpen(false)} />}
      <ManualUpload onLoad={onUpload} />
      <FederationSection report={state.federation} score={state.federationScore} />
      <ProjectsSection projects={state.projects} onDrop={(n) => dispatch({ type: 'drop', name: n })} />
      {state.projects.length === 0 && (
        <div className="audit-empty">
          <p>
            No Module Federation manifests detected yet. If your app uses
            MF 2.0 (<code>@module-federation/enhanced</code>), reload the
            page — they'll auto-discover. For classic Webpack 5 MF, generate
            a manifest with the <code>mf-inspector</code> CLI and upload it
            above.{' '}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); setHelpOpen(true) }}
            >
              How does this work?
            </a>
          </p>
          <p className="audit-empty-hint">
            Auto-discovery polls <code>window.__FEDERATION__</code> for ~15s
            after document_start and watches for <code>mf-manifest.json</code>
            {' '}network requests via the DevTools API.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Help popover ─────────────────────────────────────────────────────────────

function AuditHelpPopover({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div
        className="help-popover"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Shared Audit help"
      >
        <div className="help-head">
          <h3>Shared Audit — how it works</h3>
          <button onClick={onClose} aria-label="Close" className="close-btn">×</button>
        </div>

        <p>
          Runs the <code>@mf-toolkit/shared-inspector</code> analyzer in the
          browser on your Module Federation manifests. Nothing has to be
          imported or wired into your app.
        </p>

        <h4>Where manifests come from</h4>

        <p>
          <strong>MF 2.0 (<code>@module-federation/enhanced</code>) — automatic.</strong>
          {' '}We poll <code>window.__FEDERATION__</code> for ~15 seconds after the
          page loads and intercept <code>mf-manifest.json</code> network
          requests off the DevTools panel. Open DevTools, switch to Shared
          Audit — that's it.
        </p>

        <p>
          <strong>Classic Webpack 5 / 4 MF — one CLI step.</strong>{' '}
          The original <code>ModuleFederationPlugin</code> doesn't expose
          anything to the browser. Generate a manifest once per MF with the
          CLI, then upload it:
        </p>
        <pre className="help-pre">
{`npx mf-inspector \\
  --source ./src \\
  --shared shared-config.json \\
  --name <mf-name> \\
  --kind host \\
  --write-manifest`}
        </pre>
        <p>
          Drag-drop the resulting <code>project-manifest.json</code> into the{' '}
          <strong>Upload JSON…</strong> button (or paste it). Repeat for
          every MF in your federation.
        </p>

        <p>
          <strong>Want the deepest audit?</strong>{' '}
          Use the CLI manifest even on MF 2.0. CLI manifests carry usage
          data — per-file imports, deep-imports, candidates — that the
          runtime <code>mf-manifest.json</code> format simply doesn't include.
          Findings like <em>unused shared</em>, <em>share candidates</em>, and
          <em> deep-import bypass</em> only populate from CLI manifests.
        </p>

        <h4>What each section means</h4>

        <dl className="legend">
          <dt><strong>Federation audit</strong></dt>
          <dd>
            Issues <em>between</em> MFs: <code>requiredVersion</code> ranges
            that don't overlap, inconsistent <code>singleton</code> flags
            across MFs, ghost shares (a package shared by one MF but
            unused/unshared by everyone else), host gaps (a package used by
            multiple MFs but shared by none). Appears when ≥ 2 manifests are
            loaded.
          </dd>
          <dt><strong>Per-project</strong></dt>
          <dd>
            Issues <em>inside</em> one MF: configured{' '}
            <code>requiredVersion</code> vs installed version, eager imports
            without <code>singleton</code>, deep-import bypass of the shared
            scope (e.g. <code>lodash/cloneDeep</code> imported directly while{' '}
            <code>lodash</code> is shared), unused shared declarations,
            packages used everywhere that should probably be shared.
          </dd>
          <dt><strong>Score</strong></dt>
          <dd>
            <code>HEALTHY</code> / <code>GOOD</code> / <code>RISKY</code> /{' '}
            <code>CRITICAL</code>, computed per project and across the whole
            federation. High-severity findings (version conflicts,
            deep-import bypass) sink the score faster than low-severity
            ones (unused shared).
          </dd>
        </dl>

        <h4>Persistence</h4>

        <p>
          Loaded manifests are remembered per <strong>origin</strong> via{' '}
          <code>chrome.storage.local</code>. Reload the page, close DevTools,
          switch sites — they survive. <code>localhost:3000</code> and{' '}
          <code>staging.example.com</code> keep independent audits.
        </p>
        <p>
          Click <code>×</code> on a project card to drop one entry. Manually
          uploaded manifests stay dropped; auto-discovered ones (MF 2.0) come
          back on the next page load if the runtime still exposes them.
        </p>

        <h4>What the analyzer never does</h4>

        <p>
          Reads no source code from your machine — only the JSON you upload
          or that the page itself fetches. Nothing is sent over the network;
          the analyzer runs locally in the panel.
        </p>
      </div>
    </div>
  )
}

// ─── Manual upload ────────────────────────────────────────────────────────────

function ManualUpload({ onLoad }: { onLoad: (raw: unknown, source: string) => void }): React.JSX.Element {
  const [paste, setPaste] = useReducer((_: string, next: string) => next, '')
  const [error, setError] = useReducer((_: string | null, next: string | null) => next, null)

  const handle = (text: string, source: string): void => {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (err) {
      setError(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    setError(null)
    onLoad(raw, source)
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (!file) return
    void file.text().then((t) => handle(t, file.name))
    e.target.value = ''
  }

  return (
    <div className="audit-upload">
      <div className="audit-upload-row">
        <label className="audit-upload-button">
          Upload JSON…
          <input type="file" accept="application/json,.json" onChange={onFile} />
        </label>
        <button
          onClick={() => {
            if (paste.trim()) handle(paste, 'paste')
          }}
          disabled={!paste.trim()}
        >
          Load pasted JSON
        </button>
        <span className="audit-upload-hint">
          Accepts MF 2.0 <code>mf-manifest.json</code> or shared-inspector{' '}
          <code>project-manifest.json</code>.
        </span>
      </div>
      <textarea
        className="audit-upload-textarea"
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        placeholder="Paste JSON here…"
        spellCheck={false}
      />
      {error && <div className="audit-upload-error">{error}</div>}
    </div>
  )
}

// ─── Federation section ───────────────────────────────────────────────────────

function FederationSection({
  report,
  score,
}: {
  report: FederationReport | null
  score: RiskScore | null
}): React.JSX.Element | null {
  if (!report) return null
  const { ghostShares, hostGaps, versionConflicts, singletonMismatches } = report
  const total =
    ghostShares.length + hostGaps.length + versionConflicts.length + singletonMismatches.length

  return (
    <section className="audit-section">
      <header>
        <h2>Federation audit</h2>
        {score && <ScoreBadge score={score} />}
      </header>
      {total === 0 && (
        <p className="audit-ok">No federation-level issues detected across the loaded manifests.</p>
      )}
      <FindingList
        title="Version conflicts"
        items={versionConflicts}
        renderItem={(c) => (
          <div>
            <strong>{c.package}</strong>
            <ul className="audit-sublist">
              {Object.entries(c.versions).map(([mf, v]) => (
                <li key={mf}><code>{mf}</code>: <code>{v}</code></li>
              ))}
            </ul>
          </div>
        )}
      />
      <FindingList
        title="Singleton mismatches"
        items={singletonMismatches}
        renderItem={(m) => (
          <div>
            <strong>{m.package}</strong>
            <div className="audit-sub">singleton: <code>{m.singletonIn.join(', ') || '—'}</code></div>
            <div className="audit-sub">non-singleton: <code>{m.nonSingletonIn.join(', ') || '—'}</code></div>
          </div>
        )}
      />
      <FindingList
        title="Ghost shares"
        items={ghostShares}
        renderItem={(g) => (
          <div>
            <strong>{g.package}</strong>{' '}
            shared by <code>{g.sharedBy}</code>; used unshared by{' '}
            <code>{g.usedUnsharedBy.join(', ') || '—'}</code>
          </div>
        )}
      />
      <FindingList
        title="Host gaps"
        items={hostGaps}
        renderItem={(h) => (
          <div>
            <strong>{h.package}</strong>{' '}
            missing in <code>{h.missingIn.join(', ')}</code>
          </div>
        )}
      />
    </section>
  )
}

// ─── Per-project section ──────────────────────────────────────────────────────

function ProjectsSection({
  projects,
  onDrop,
}: {
  projects: ProjectEntry[]
  onDrop: (name: string) => void
}): React.JSX.Element | null {
  if (projects.length === 0) return null
  return (
    <section className="audit-section">
      <header>
        <h2>Projects ({projects.length})</h2>
      </header>
      {projects.map((p) => (
        <ProjectCard key={p.manifest.project.name} entry={p} onDrop={onDrop} />
      ))}
    </section>
  )
}

function ProjectCard({
  entry,
  onDrop,
}: {
  entry: ProjectEntry
  onDrop: (name: string) => void
}): React.JSX.Element {
  const { manifest, report, score, source } = entry
  return (
    <article className="audit-project">
      <header className="audit-project-header">
        <strong>{manifest.project.name}</strong>
        <span className="audit-project-kind">{manifest.project.kind ?? 'unknown'}</span>
        <ScoreBadge score={score} />
        <button className="audit-project-drop" onClick={() => onDrop(manifest.project.name)} title="Remove">
          ×
        </button>
      </header>
      {source && <div className="audit-project-source" title={source}>{source}</div>}
      <ProjectFindings report={report} />
    </article>
  )
}

function ProjectFindings({ report }: { report: ProjectReport }): React.JSX.Element {
  return (
    <div className="audit-findings">
      <FindingList<MismatchedEntry>
        title="Version mismatches"
        items={report.mismatched}
        renderItem={(m) => (
          <div>
            <strong>{m.package}</strong>{' '}
            configured <code>{m.configured}</code> vs installed <code>{m.installed}</code>
          </div>
        )}
      />
      <FindingList<SingletonRiskEntry>
        title="Singleton risks"
        items={report.singletonRisks}
        renderItem={(s) => <code>{s.package}</code>}
      />
      <FindingList<EagerRiskEntry>
        title="Eager risks"
        items={report.eagerRisks}
        renderItem={(e) => <code>{e.package}</code>}
      />
      <FindingList<UnusedEntry>
        title="Unused shared"
        items={report.unused}
        renderItem={(u) => <code>{u.package}</code>}
      />
      <FindingList<CandidateEntry>
        title="Share candidates"
        items={report.candidates}
        renderItem={(c) => (
          <div>
            <code>{c.package}</code> <small>· {c.importCount} files</small>
          </div>
        )}
      />
      <FindingList<DeepImportBypassEntry>
        title="Deep-import bypass"
        items={report.deepImportBypass}
        renderItem={(d) => (
          <div>
            <strong>{d.package}</strong>{' '}
            <small>{d.specifiers.slice(0, 3).join(', ')}{d.specifiers.length > 3 ? ` +${d.specifiers.length - 3}` : ''}</small>
          </div>
        )}
      />
    </div>
  )
}

// ─── Generic helpers ──────────────────────────────────────────────────────────

interface FindingListProps<T> {
  title: string
  items: T[]
  renderItem: (item: T) => React.ReactNode
}

function FindingList<T>({ title, items, renderItem }: FindingListProps<T>): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="audit-finding-list">
      <h4>{title} <span className="count">({items.length})</span></h4>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{renderItem(item)}</li>
        ))}
      </ul>
    </div>
  )
}

function ScoreBadge({ score }: { score: RiskScore }): React.JSX.Element {
  const cls = score.label === 'CRITICAL' || score.label === 'RISKY'
    ? 'audit-score-bad'
    : score.label === 'GOOD'
      ? 'audit-score-mid'
      : 'audit-score-ok'
  return (
    <span className={`audit-score ${cls}`} title={`Score: ${score.score}`}>
      {score.label.toLowerCase()}
    </span>
  )
}
