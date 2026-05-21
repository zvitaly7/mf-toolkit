// ─── Browser-safe public API ──────────────────────────────────────────────────
//
// Subset of @mf-toolkit/shared-inspector that runs in the browser:
//   • analyzer   — pure TS, accepts ProjectManifest, returns ProjectReport / FederationReport
//   • adapters   — normalise MF 2.0 / ProjectManifest JSON inputs
//   • parser     — normalise raw `shared` config (Object | Array | string[])
//   • scoring    — risk score for a report
//   • types      — full type surface
//
// Excluded (Node-only):
//   • collector/build-project-manifest, traverse-local-modules, resolve-versions,
//     resolve-tsconfig-paths, collect-imports — read source files, package.json,
//     node_modules; require fs/path
//   • plugins/webpack, cli/* — bundler / Node entry points
//   • reporter/write-report — fs writes
//
// The CLI-flavoured text formatters (formatReport, formatFederationReport,
// diagnostics) are pure JS and could be re-exported here, but the browser
// consumer (mf-devtools panel) renders findings with React, not strings.
// Keeping them out keeps the browser bundle smaller; add them back if needed.

// ─── Analyzer ─────────────────────────────────────────────────────────────────
export { analyzeProject } from './analyzer/analyze-project.js';
export { analyzeFederation } from './analyzer/analyze-federation.js';

// ─── MF 2.0 manifest ingestion ────────────────────────────────────────────────
export {
  isMf2Manifest,
  adaptMf2Manifest,
  type Mf2RawManifest,
  type Mf2SharedEntry,
} from './collector/read-mf2-manifest.js';
export { parseManifestInput } from './collector/parse-manifest-input.js';

// ─── Shared-config parser ─────────────────────────────────────────────────────
export { parseSharedConfig } from './collector/parse-shared-config.js';

// ─── Scoring ──────────────────────────────────────────────────────────────────
export {
  scoreProjectReport,
  scoreFederationReport,
  type RiskScore,
} from './reporter/scoring.js';

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  ProjectManifest,
  ProjectReport,
  AnalysisOptions,
  SharedDepConfig,
  UnusedEntry,
  CandidateEntry,
  MismatchedEntry,
  SingletonRiskEntry,
  EagerRiskEntry,
  DeepImportBypassEntry,
  FederationAnalysisOptions,
  FederationReport,
  GhostShareEntry,
  HostGapEntry,
  VersionConflictEntry,
  SingletonMismatchEntry,
} from './types.js';
