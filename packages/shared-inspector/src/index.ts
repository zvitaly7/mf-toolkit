// ─── Two-phase API ────────────────────────────────────────────────────────────
export { buildProjectManifest } from './collector/build-project-manifest.js';
export { analyzeProject } from './analyzer/analyze-project.js';

// ─── Shortcut API ─────────────────────────────────────────────────────────────
export { inspect } from './inspect.js';

// ─── Reporter ─────────────────────────────────────────────────────────────────
export { formatReport } from './reporter/format-report.js';
export { writeReport, writeManifest } from './reporter/write-report.js';

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
} from './types.js';
