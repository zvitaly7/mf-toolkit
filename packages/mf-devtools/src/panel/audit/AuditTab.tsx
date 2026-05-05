import { useEffect, useReducer, useRef } from 'react'
import type { FederationRemoteHint, MFEvent } from '../../shared/protocol.js'
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
        const url = resolveManifestUrl(hint)
        if (!url || fetchedUrlsRef.current.has(url)) continue
        fetchedUrlsRef.current.add(url)
        const result = await fetchManifest(url, ctrl.signal)
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
      <ManualUpload onLoad={onUpload} />
      <FederationSection report={state.federation} score={state.federationScore} />
      <ProjectsSection projects={state.projects} onDrop={(n) => dispatch({ type: 'drop', name: n })} />
      {state.projects.length === 0 && (
        <div className="audit-empty">
          <p>
            No Module Federation manifests detected yet. Reload the page if
            it loaded before DevTools opened, or upload a manifest / report
            JSON manually using the form above.
          </p>
          <p style={{ fontSize: 11, color: '#888' }}>
            Auto-discovery uses <code>window.__FEDERATION__</code> (MF 2.0)
            and watches for <code>mf-manifest.json</code> network requests.
          </p>
        </div>
      )}
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
        placeholder='Paste JSON here…'
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
        empty="No conflicting requiredVersion ranges across MFs."
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
        empty="No singleton-flag inconsistencies."
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
        empty="No ghost shares."
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
        empty="Every used package is shared somewhere."
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
        empty="—"
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
        empty="—"
        renderItem={(s) => <code>{s.package}</code>}
      />
      <FindingList<EagerRiskEntry>
        title="Eager risks"
        items={report.eagerRisks}
        empty="—"
        renderItem={(e) => <code>{e.package}</code>}
      />
      <FindingList<UnusedEntry>
        title="Unused shared"
        items={report.unused}
        empty="—"
        renderItem={(u) => <code>{u.package}</code>}
      />
      <FindingList<CandidateEntry>
        title="Share candidates"
        items={report.candidates}
        empty="—"
        renderItem={(c) => (
          <div>
            <code>{c.package}</code> <small>· {c.importCount} files</small>
          </div>
        )}
      />
      <FindingList<DeepImportBypassEntry>
        title="Deep-import bypass"
        items={report.deepImportBypass}
        empty="—"
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
  empty: string
  renderItem: (item: T) => React.ReactNode
}

function FindingList<T>({ title, items, empty, renderItem }: FindingListProps<T>): React.JSX.Element | null {
  if (items.length === 0) {
    if (empty === '—') return null // Hide empty per-project sections to reduce noise
    return null
  }
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

/** Applied to MFEvents from upstream to keep federation hints in sync. */
export function isFederationEvent(e: MFEvent): e is Extract<MFEvent, { kind: 'federation' }> {
  return e.kind === 'federation'
}
