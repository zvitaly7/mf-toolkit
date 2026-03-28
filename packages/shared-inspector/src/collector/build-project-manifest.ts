import { resolve, dirname } from 'node:path';
import type { CollectorOptions, ProjectManifest, PackageOccurrence } from '../types.js';
import { collectImports, scanFiles } from './collect-imports.js';
import { parseSharedConfig } from './parse-shared-config.js';
import { resolveVersions } from './resolve-versions.js';

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Phase 1 of the two-phase pipeline: collect observable dependency facts
 * and assemble them into a self-contained ProjectManifest.
 *
 * The manifest captures facts at the chosen depth; it does not make
 * any policy decisions — that is the analyzer's job.
 */
export async function buildProjectManifest(
  options: CollectorOptions,
): Promise<ProjectManifest> {
  const {
    name,
    sourceDirs,
    depth = 'local-graph',
    sharedConfig,
    kind = 'unknown',
    packageJsonPath = './package.json',
    extensions = DEFAULT_EXTENSIONS,
    ignore,
  } = options;

  const resolvedPkgJsonPath = resolve(packageJsonPath);
  const root = dirname(resolvedPkgJsonPath);

  // ── Step 1: scan files (for filesScanned count) ───────────────────────────
  const allFiles = await scanFiles(sourceDirs, extensions);

  // ── Step 2: collect package occurrences ───────────────────────────────────
  let occurrences: PackageOccurrence[];
  let effectiveDepth: 'direct' | 'local-graph';

  if (depth === 'local-graph') {
    // TODO(step-10): replace with traverseLocalModules when implemented
    throw new Error(
      '[shared-inspector] depth: "local-graph" is not yet implemented. ' +
      'Use depth: "direct" or wait for the next step.',
    );
  } else {
    occurrences = await collectImports({ sourceDirs, extensions, ignore });
    effectiveDepth = 'direct';
  }

  // ── Step 3: aggregate occurrences into packageDetails ────────────────────
  const byPackage = new Map<string, { files: Set<string>; via: 'direct' | 'reexport' }>();
  for (const occ of occurrences) {
    if (!byPackage.has(occ.package)) {
      byPackage.set(occ.package, { files: new Set(), via: occ.via });
    }
    byPackage.get(occ.package)!.files.add(occ.file);
  }

  const packageDetails = Array.from(byPackage.entries()).map(([pkg, { files, via }]) => ({
    package: pkg,
    importCount: files.size,
    files: [...files].sort(),
    via,
  }));

  const directPackages = packageDetails
    .filter((d) => d.via === 'direct')
    .map((d) => d.package);

  // For depth: 'direct', resolvedPackages === directPackages
  const resolvedPackages = [...directPackages];

  // ── Step 4: parse shared config ───────────────────────────────────────────
  const sharedDeclared = parseSharedConfig(sharedConfig);

  // ── Step 5: resolve versions ──────────────────────────────────────────────
  const versions = await resolveVersions(resolvedPkgJsonPath);

  // ── Assemble manifest ─────────────────────────────────────────────────────
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),

    project: { name, root, kind },

    source: {
      depth: effectiveDepth,
      sourceDirs,
      filesScanned: allFiles.length,
    },

    usage: {
      directPackages,
      resolvedPackages,
      packageDetails,
    },

    shared: {
      declared: sharedDeclared,
      source: 'explicit',
    },

    versions,
  };
}
