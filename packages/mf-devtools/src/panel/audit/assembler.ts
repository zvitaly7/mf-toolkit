/**
 * Combines manifests obtained from any source (network watcher, federation
 * snapshot, manual upload) into a deduplicated set of `ProjectManifest`s,
 * ready to feed `analyzeFederation`.
 *
 * Inputs accepted:
 *   • MF 2.0 raw manifests   → adapted via shared-inspector's adaptMf2Manifest
 *   • shared-inspector manifests already in canonical form → passed through
 *   • shared-inspector reports → not re-runnable; surfaced as ready-to-show
 *
 * Deduplication keys on `project.name` so loading the same manifest twice
 * (e.g. once from the network watcher and once from the federation poller)
 * produces a single entry.
 */

import {
  adaptMf2Manifest,
  isMf2Manifest,
  analyzeFederation,
  analyzeProject,
  scoreFederationReport,
  scoreProjectReport,
  type ProjectManifest,
  type ProjectReport,
  type FederationReport,
  type RiskScore,
} from '@mf-toolkit/shared-inspector/browser'

export interface ProjectEntry {
  manifest: ProjectManifest
  /** Per-project report against this single manifest. */
  report: ProjectReport
  score: RiskScore
  /** URL the manifest was fetched from, when known. */
  source?: string
}

export interface AuditState {
  projects: ProjectEntry[]
  federation: FederationReport | null
  federationScore: RiskScore | null
}

export const emptyAudit: AuditState = {
  projects: [],
  federation: null,
  federationScore: null,
}

/**
 * Tries to convert an arbitrary JSON blob into a canonical ProjectManifest.
 * Returns null when the shape doesn't match either format.
 */
export function adaptUnknown(raw: unknown, sourceUrl?: string): ProjectManifest | null {
  if (!raw || typeof raw !== 'object') return null

  if (isMf2Manifest(raw)) {
    try {
      return adaptMf2Manifest(raw)
    } catch {
      return null
    }
  }

  // Heuristic: shared-inspector manifest (schemaVersion === 2)
  const schemaVersion = (raw as { schemaVersion?: unknown }).schemaVersion
  if (schemaVersion === 2) return raw as ProjectManifest

  return null
}

/**
 * Append a manifest to the state, dedup on project name, recompute reports.
 */
export function ingest(state: AuditState, manifest: ProjectManifest, sourceUrl?: string): AuditState {
  const name = manifest.project?.name
  const projects = state.projects.slice()

  const idx = name ? projects.findIndex((p) => p.manifest.project?.name === name) : -1
  const entry: ProjectEntry = {
    manifest,
    report: analyzeProject(manifest),
    score: scoreProjectReport(analyzeProject(manifest)),
    source: sourceUrl,
  }
  if (idx >= 0) projects[idx] = entry
  else projects.push(entry)

  const manifests = projects.map((p) => p.manifest)
  const federation = manifests.length >= 2 ? analyzeFederation(manifests) : null
  const federationScore = federation ? scoreFederationReport(federation) : null

  return { projects, federation, federationScore }
}

export function ingestRaw(state: AuditState, raw: unknown, sourceUrl?: string): AuditState {
  const manifest = adaptUnknown(raw, sourceUrl)
  if (!manifest) return state
  return ingest(state, manifest, sourceUrl)
}

/** Removes a project entry and recomputes the federation report. */
export function dropProject(state: AuditState, name: string): AuditState {
  const projects = state.projects.filter((p) => p.manifest.project?.name !== name)
  const manifests = projects.map((p) => p.manifest)
  const federation = manifests.length >= 2 ? analyzeFederation(manifests) : null
  const federationScore = federation ? scoreFederationReport(federation) : null
  return { projects, federation, federationScore }
}
