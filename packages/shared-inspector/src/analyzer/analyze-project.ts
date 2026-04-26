import type { ProjectManifest, ProjectReport, AnalysisOptions } from '../types.js';
import { detectIssues } from './detect-issues.js';
import { mergePolicy } from './policy.js';

/**
 * Analyze a single ProjectManifest and return a ProjectReport.
 *
 * Pure function — no I/O. All findings are scoped to what the collector
 * observed at the chosen depth (manifest.source.depth).
 */
export function analyzeProject(
  manifest: ProjectManifest,
  options?: AnalysisOptions,
): ProjectReport {
  const policy = mergePolicy(options);

  const { unused, candidates, mismatched, singletonRisks, eagerRisks, deepImportBypass } =
    detectIssues({
      resolvedPackages: manifest.usage.resolvedPackages,
      packageDetails: manifest.usage.packageDetails,
      sharedDeclared: manifest.shared.declared,
      installedVersions: manifest.versions.installed,
      policy,
    });

  const totalShared = Object.keys(manifest.shared.declared).length;
  const resolvedSet = new Set(manifest.usage.resolvedPackages);
  const usedShared = Object.keys(manifest.shared.declared).filter(pkg =>
    resolvedSet.has(pkg),
  ).length;

  return {
    unused,
    candidates,
    mismatched,
    singletonRisks,
    eagerRisks,
    deepImportBypass,
    summary: {
      totalShared,
      usedShared,
      unusedCount: unused.length,
      candidatesCount: candidates.length,
      mismatchedCount: mismatched.length,
      singletonRisksCount: singletonRisks.length,
      eagerRisksCount: eagerRisks.length,
      deepImportBypassCount: deepImportBypass.length,
    },
  };
}
