import semver from 'semver';
import type {
  UnusedEntry,
  CandidateEntry,
  MismatchedEntry,
  SingletonRiskEntry,
} from '../types.js';
import type { ResolvedPolicy } from './policy.js';

// ─── Input / Output ───────────────────────────────────────────────────────────

export interface DetectIssuesInput {
  resolvedPackages: string[];
  packageDetails: Array<{
    package: string;
    importCount: number;
    files: string[];
    via: 'direct' | 'reexport';
  }>;
  sharedDeclared: Record<string, {
    singleton?: boolean;
    eager?: boolean;
    requiredVersion?: string;
  }>;
  /** From node_modules. Empty object = not accessible, mismatch checks skipped for absent entries. */
  installedVersions: Record<string, string>;
  policy: ResolvedPolicy;
}

export interface DetectIssuesResult {
  unused: UnusedEntry[];
  candidates: CandidateEntry[];
  mismatched: MismatchedEntry[];
  singletonRisks: SingletonRiskEntry[];
}

// ─── Core detection ───────────────────────────────────────────────────────────

/**
 * Pure function — no I/O.
 * Cross-checks manifest data against policy to produce findings.
 * All results are scoped to what the collector observed at the chosen depth.
 */
export function detectIssues(input: DetectIssuesInput): DetectIssuesResult {
  const resolvedSet = new Set(input.resolvedPackages);
  const sharedEntries = Object.entries(input.sharedDeclared);
  const detailsMap = new Map(input.packageDetails.map(d => [d.package, d]));

  // Unused: in shared config but not observed in resolvedPackages
  // Packages in alwaysShared are always excluded from this list.
  const unused: UnusedEntry[] = sharedEntries
    .filter(([pkg]) => !resolvedSet.has(pkg) && !input.policy.alwaysShared.has(pkg))
    .map(([pkg, config]) => ({
      package: pkg,
      singleton: config.singleton ?? false,
    }));

  // Candidates: observed but not shared, and in the built-in share-candidates list
  const candidates: CandidateEntry[] = input.resolvedPackages
    .filter(pkg => !input.sharedDeclared[pkg] && input.policy.shareCandidates.has(pkg))
    .map(pkg => {
      const detail = detailsMap.get(pkg);
      return {
        package: pkg,
        importCount: detail?.importCount ?? 1,
        files: detail?.files ?? [],
        via: detail?.via ?? 'direct',
      };
    });

  // Mismatched: requiredVersion does not satisfy the installed version.
  // Skipped when installed version is unknown (installedVersions[pkg] absent).
  const mismatched: MismatchedEntry[] = [];
  for (const [pkg, config] of sharedEntries) {
    if (!config.requiredVersion) continue;
    const installed = input.installedVersions[pkg];
    if (!installed) continue;
    try {
      if (!semver.satisfies(installed, config.requiredVersion)) {
        mismatched.push({
          package: pkg,
          configured: config.requiredVersion,
          installed,
        });
      }
    } catch {
      // Invalid semver range — skip silently
    }
  }

  // Singleton risks: in the singleton-risk list but shared without singleton: true
  const singletonRisks: SingletonRiskEntry[] = sharedEntries
    .filter(([pkg, config]) => input.policy.singletonRisks.has(pkg) && !config.singleton)
    .map(([pkg]) => ({ package: pkg }));

  return { unused, candidates, mismatched, singletonRisks };
}
