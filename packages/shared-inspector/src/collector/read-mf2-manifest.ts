/**
 * Adapter for Module Federation 2.0 (`@module-federation/enhanced`) manifests.
 *
 * MF 2.0 builds emit a standardised `mf-manifest.json` next to `remoteEntry.js`
 * in `dist/`. The file describes shared dependencies, remotes and exposes after
 * the bundler has resolved versions — so it is a strictly more accurate source
 * of facts than reading the user's webpack/rspack/vite config.
 *
 * This module:
 *   1. Detects the MF 2.0 shape via `isMf2Manifest`
 *   2. Maps it onto our internal `ProjectManifest` (schemaVersion: 2) via
 *      `adaptMf2Manifest`
 *
 * The adapter is intentionally lossy: source-code usage is not knowable from the
 * manifest, so `usage.resolvedPackages` is set to the locally-declared shared
 * names. `analyzeFederation` then reasons about ghost shares, host gaps,
 * version conflicts and singleton mismatches using the shared declarations
 * directly — which is exactly the data the MF runtime negotiates over.
 */

import type { ProjectManifest } from '../types.js';

// ─── MF 2.0 raw shape (subset we read) ────────────────────────────────────────

/**
 * Subset of `mf-manifest.json` that we consume. We accept `unknown` extra
 * fields so future MF schema additions are forward-compatible.
 */
export interface Mf2SharedEntry {
  id?: string;
  name: string;
  version?: string;
  singleton?: boolean;
  requiredVersion?: string;
  eager?: boolean;
  /** MF that originally declared this shared. May be omitted on legacy outputs. */
  from?: string;
  [extra: string]: unknown;
}

export interface Mf2RawManifest {
  id?: string;
  name: string;
  metaData?: {
    name?: string;
    /** 'app' is typically a host, 'lib' a remote; not enforced. */
    type?: string;
    publicPath?: string;
    [extra: string]: unknown;
  };
  shared?: Mf2SharedEntry[];
  remotes?: unknown[];
  exposes?: unknown[];
  [extra: string]: unknown;
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Returns true when `obj` is structurally an MF 2.0 manifest.
 *
 * Distinguishes from our own ProjectManifest by absence of `schemaVersion` and
 * presence of MF 2.0-specific fields (`metaData` or top-level `shared` array).
 */
export function isMf2Manifest(obj: unknown): obj is Mf2RawManifest {
  if (obj === null || typeof obj !== 'object') return false;
  const r = obj as Record<string, unknown>;

  // Our own ProjectManifest carries schemaVersion — MF 2.0 manifest does not.
  if ('schemaVersion' in r) return false;

  if (typeof r['name'] !== 'string') return false;

  const hasMetaData = typeof r['metaData'] === 'object' && r['metaData'] !== null;
  const hasShared = Array.isArray(r['shared']);
  return hasMetaData || hasShared;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Convert an MF 2.0 manifest into our internal `ProjectManifest`.
 *
 * Mapping notes:
 *   - `kind` is inferred from `metaData.type` first, then from the
 *     presence of `remotes`/`exposes`. Defaults to `'unknown'`.
 *   - Only shared entries with `from === name` (or no `from`) are treated
 *     as locally declared, matching what the MF user wrote in their config.
 *     Inherited shared (e.g. host-provided in a remote's manifest) are
 *     filtered out so we don't double-count them in federation analysis.
 *   - `versions.installed` is populated from the shared entries themselves —
 *     these are the post-resolution versions the bundler actually used.
 *   - `usage.resolvedPackages` is set to the locally-declared shared names
 *     since per-file usage is not part of the MF 2.0 manifest.
 */
export function adaptMf2Manifest(raw: unknown): ProjectManifest {
  if (!isMf2Manifest(raw)) {
    throw new Error('Not an MF 2.0 manifest: missing name/metaData/shared');
  }
  const m = raw;
  const name = m.name;
  const remotesCount = Array.isArray(m.remotes) ? m.remotes.length : 0;
  const exposesCount = Array.isArray(m.exposes) ? m.exposes.length : 0;

  const sharedDeclared: ProjectManifest['shared']['declared'] = {};
  const installed: Record<string, string> = {};

  for (const entry of m.shared ?? []) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') continue;

    const isLocal = entry.from === undefined || entry.from === name;
    if (!isLocal) continue;

    const cfg: { singleton?: boolean; eager?: boolean; requiredVersion?: string } = {};
    if (entry.singleton !== undefined) cfg.singleton = entry.singleton;
    if (entry.eager !== undefined) cfg.eager = entry.eager;
    if (typeof entry.requiredVersion === 'string') cfg.requiredVersion = entry.requiredVersion;

    sharedDeclared[entry.name] = cfg;

    if (typeof entry.version === 'string') {
      installed[entry.name] = entry.version;
    }
  }

  const sharedNames = Object.keys(sharedDeclared);

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    project: {
      name,
      root: '',
      kind: inferKind(m.metaData?.type, remotesCount, exposesCount),
    },
    source: {
      depth: 'direct',
      sourceDirs: [],
      filesScanned: 0,
    },
    usage: {
      directPackages: sharedNames,
      resolvedPackages: sharedNames,
      packageDetails: sharedNames.map((pkg) => ({
        package: pkg,
        importCount: 0,
        files: [],
        via: 'direct' as const,
        deepImports: [],
      })),
    },
    shared: {
      declared: sharedDeclared,
      source: 'extracted-from-plugin',
    },
    versions: {
      declared: {},
      installed,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferKind(
  type: string | undefined,
  remotesCount: number,
  exposesCount: number,
): 'host' | 'remote' | 'unknown' {
  if (type === 'app') return 'host';
  if (type === 'lib') return 'remote';
  if (remotesCount > 0 && exposesCount === 0) return 'host';
  if (exposesCount > 0 && remotesCount === 0) return 'remote';
  return 'unknown';
}
