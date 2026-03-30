import semver from 'semver';
import type {
  ProjectManifest,
  FederationAnalysisOptions,
  FederationReport,
  GhostShareEntry,
  HostGapEntry,
  VersionConflictEntry,
  SingletonMismatchEntry,
} from '../types.js';

const DEFAULT_ALWAYS_SHARED = ['react', 'react-dom'];

/**
 * Returns true when two semver ranges have at least one version in common.
 * Strategy: the max of the two minimums must satisfy both ranges.
 * e.g. ^18.0.0 and ^18.2.0 → max(18.0.0, 18.2.0) = 18.2.0 → satisfies both → compatible.
 * e.g. ^17.0.0 and ^18.0.0 → max(17.0.0, 18.0.0) = 18.0.0 → fails ^17 → conflict.
 */
function rangesOverlap(a: string, b: string): boolean {
  if (!semver.validRange(a) || !semver.validRange(b)) return true; // unknown → assume ok
  const minA = semver.minVersion(a);
  const minB = semver.minVersion(b);
  if (!minA || !minB) return true;
  const candidate = semver.gt(minA, minB) ? minA : minB;
  return semver.satisfies(candidate, a) && semver.satisfies(candidate, b);
}

/**
 * Cross-MF analysis: accepts N project manifests and detects federation-level issues
 * that are invisible when analysing each MF in isolation.
 *
 * Pure function — no I/O, no side effects.
 */
export function analyzeFederation(
  manifests: ProjectManifest[],
  options?: FederationAnalysisOptions,
): FederationReport {
  if (manifests.length === 0) {
    return {
      ghostShares: [], hostGaps: [], versionConflicts: [], singletonMismatches: [],
      summary: { totalManifests: 0, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    };
  }

  const alwaysShared = new Set(options?.alwaysShared ?? DEFAULT_ALWAYS_SHARED);

  // ── Index manifests ────────────────────────────────────────────────────────

  /** All packages declared in shared config per MF: pkg → Set<mfName> */
  const sharedByPkg = new Map<string, Set<string>>();
  /** All packages observed in source per MF: pkg → Set<mfName> */
  const usedByPkg = new Map<string, Set<string>>();
  /** requiredVersion per MF per pkg: pkg → Map<mfName, version> */
  const versionsByPkg = new Map<string, Map<string, string>>();
  /**
   * singleton flag per MF per pkg — only for MFs that explicitly set singleton.
   * pkg → Map<mfName, boolean>
   */
  const explicitSingletonByPkg = new Map<string, Map<string, boolean>>();

  for (const manifest of manifests) {
    const mfName = manifest.project.name;

    for (const [pkg, cfg] of Object.entries(manifest.shared.declared)) {
      if (!sharedByPkg.has(pkg)) sharedByPkg.set(pkg, new Set());
      sharedByPkg.get(pkg)!.add(mfName);

      if (cfg.requiredVersion) {
        if (!versionsByPkg.has(pkg)) versionsByPkg.set(pkg, new Map());
        versionsByPkg.get(pkg)!.set(mfName, cfg.requiredVersion);
      }

      if (cfg.singleton !== undefined) {
        if (!explicitSingletonByPkg.has(pkg)) explicitSingletonByPkg.set(pkg, new Map());
        explicitSingletonByPkg.get(pkg)!.set(mfName, cfg.singleton);
      }
    }

    for (const pkg of manifest.usage.resolvedPackages) {
      if (!usedByPkg.has(pkg)) usedByPkg.set(pkg, new Set());
      usedByPkg.get(pkg)!.add(mfName);
    }
  }

  // ── Ghost shares ───────────────────────────────────────────────────────────
  // Package shared by exactly one MF with no other MF sharing or benefiting from it.
  // Requires at least 2 manifests — with one MF there's nothing to compare.

  const ghostShares: GhostShareEntry[] = [];

  if (manifests.length > 1) {
    for (const [pkg, sharedByMfs] of sharedByPkg) {
      if (alwaysShared.has(pkg)) continue;
      if (sharedByMfs.size !== 1) continue; // shared by multiple → not a ghost

      const soloMf = [...sharedByMfs][0];
      const usedByMfs = usedByPkg.get(pkg) ?? new Set<string>();

      // Other MFs that use the pkg but don't declare it in shared
      const usedUnsharedBy = [...usedByMfs].filter(
        (mf) => mf !== soloMf && !sharedByPkg.get(pkg)?.has(mf),
      );

      const otherMfsUseIt = [...usedByMfs].some((mf) => mf !== soloMf);

      if (!otherMfsUseIt) {
        // No other MF uses it at all — pure ghost share
        ghostShares.push({ package: pkg, sharedBy: soloMf, usedUnsharedBy: [] });
      } else if (usedUnsharedBy.length > 0) {
        // Other MFs use it but haven't declared it in shared
        ghostShares.push({ package: pkg, sharedBy: soloMf, usedUnsharedBy });
      }
    }
  }

  // ── Host gaps ──────────────────────────────────────────────────────────────
  // Package used by 2+ MFs but not declared in shared by anyone.

  const hostGaps: HostGapEntry[] = [];

  for (const [pkg, usedByMfs] of usedByPkg) {
    if (usedByMfs.size < 2) continue;
    if (alwaysShared.has(pkg)) continue;
    const sharedByMfs = sharedByPkg.get(pkg);
    if (sharedByMfs && sharedByMfs.size > 0) continue;

    hostGaps.push({ package: pkg, missingIn: [...usedByMfs] });
  }

  // ── Version conflicts ──────────────────────────────────────────────────────
  // Package where requiredVersion ranges across MFs have no overlap.

  const versionConflicts: VersionConflictEntry[] = [];

  for (const [pkg, mfVersions] of versionsByPkg) {
    if (mfVersions.size < 2) continue;

    const ranges = [...mfVersions.values()];
    const validRanges = ranges.filter((r) => semver.validRange(r));
    if (validRanges.length < 2) continue;

    // Check all pairs of ranges for overlap — any non-overlapping pair is a conflict
    let hasConflict = false;
    outer: for (let i = 0; i < validRanges.length; i++) {
      for (let j = i + 1; j < validRanges.length; j++) {
        if (!rangesOverlap(validRanges[i], validRanges[j])) {
          hasConflict = true;
          break outer;
        }
      }
    }

    if (hasConflict) {
      versionConflicts.push({ package: pkg, versions: Object.fromEntries(mfVersions) });
    }
  }

  // ── Singleton mismatches ───────────────────────────────────────────────────
  // Package where some MFs declare singleton: true and others don't (false or absent).

  const singletonMismatches: SingletonMismatchEntry[] = [];

  for (const [pkg, sharedByMfs] of sharedByPkg) {
    if (sharedByMfs.size < 2) continue;

    const explicitMap = explicitSingletonByPkg.get(pkg) ?? new Map<string, boolean>();

    const singletonIn = [...sharedByMfs].filter((mf) => explicitMap.get(mf) === true);
    const nonSingletonIn = [...sharedByMfs].filter((mf) => explicitMap.get(mf) !== true);

    if (singletonIn.length > 0 && nonSingletonIn.length > 0) {
      singletonMismatches.push({ package: pkg, singletonIn, nonSingletonIn });
    }
  }

  return {
    ghostShares,
    hostGaps,
    versionConflicts,
    singletonMismatches,
    summary: {
      totalManifests: manifests.length,
      ghostSharesCount: ghostShares.length,
      hostGapsCount: hostGaps.length,
      versionConflictsCount: versionConflicts.length,
      singletonMismatchesCount: singletonMismatches.length,
    },
  };
}
