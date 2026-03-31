// ─── Two-phase API ────────────────────────────────────────────────────────────
export { buildProjectManifest } from './collector/build-project-manifest.js';
export { analyzeProject } from './analyzer/analyze-project.js';
export { analyzeFederation } from './analyzer/analyze-federation.js';

// ─── Shortcut API ─────────────────────────────────────────────────────────────
export { inspect } from './inspect.js';

// ─── Reporter ─────────────────────────────────────────────────────────────────
export { formatReport, type FormatReportContext } from './reporter/format-report.js';
export { formatFederationReport } from './reporter/format-federation-report.js';
export { writeReport, writeManifest } from './reporter/write-report.js';
export { scoreProjectReport, scoreFederationReport, type RiskScore } from './reporter/scoring.js';

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  ProjectManifest,
  ProjectReport,
  CollectorOptions,
  AnalysisOptions,
  SharedDepConfig,
  PackageOccurrence,
  UnusedEntry,
  CandidateEntry,
  MismatchedEntry,
  SingletonRiskEntry,
  EagerRiskEntry,
  FederationAnalysisOptions,
  FederationReport,
  GhostShareEntry,
  HostGapEntry,
  VersionConflictEntry,
  SingletonMismatchEntry,
} from './types.js';
