import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import type { PackageOccurrence } from '../types.js';
import { scanFiles } from './collect-imports.js';
import {
  parseDeclarations,
  isRelativeSpecifier,
  isNodeBuiltin,
  normalizePackageName,
} from './parse-declarations.js';
import {
  loadTsConfigPaths,
  resolveAliasedSpecifier,
  type ResolvedTsConfigPaths,
} from './resolve-tsconfig-paths.js';

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

export interface TraverseLocalModulesOptions {
  sourceDirs: string[];
  extensions?: string[];
  ignore?: string[];
  /** Path to tsconfig.json for resolving path aliases (e.g. '@app/*'). */
  tsconfigPath?: string;
  /** Workspace package names/globs to skip (e.g. '@my-org/*'). */
  workspacePackages?: string[];
}

/**
 * Local-graph mode collector.
 *
 * Scans all files in sourceDirs and follows relative import/export chains
 * recursively within those directories. Finds external packages reachable
 * through barrel re-exports and local module wrappers.
 *
 * When tsconfigPath is provided, TypeScript path aliases (e.g. '@app/*') are
 * resolved to local files and followed in the same DFS — packages behind
 * aliases become visible.
 *
 * Uses two-phase approach:
 *   Phase 1 — parallel async reads of all source files into contentMap
 *   Phase 2 — synchronous DFS over in-memory content (zero disk I/O)
 */
export async function traverseLocalModules(
  options: TraverseLocalModulesOptions,
): Promise<PackageOccurrence[]> {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const files = await scanFiles(options.sourceDirs, extensions);

  // Phase 1: pre-read all files in parallel — turns F sequential disk reads
  // into a single concurrent batch, giving 3-8× speedup on large projects.
  const contentMap = new Map<string, string>();
  await Promise.all(
    files.map(async (filePath) => {
      try {
        contentMap.set(filePath, await readFile(filePath, 'utf-8'));
      } catch {
        // Unreadable files are skipped silently during DFS
      }
    }),
  );

  // Load tsconfig path aliases once, before DFS
  const tsConfigPaths: ResolvedTsConfigPaths | null = options.tsconfigPath
    ? loadTsConfigPaths(options.tsconfigPath)
    : null;

  const visited = new Set<string>();
  /** (package, file) key → set of distinct specifiers + dominant `via` */
  const occurrences = new Map<
    string,
    { package: string; file: string; specifiers: Set<string>; via: 'direct' | 'reexport' }
  >();

  // Phase 2: DFS over in-memory content — no disk I/O during traversal.
  function visit(filePath: string): void {
    if (visited.has(filePath)) return;
    visited.add(filePath);

    const content = contentMap.get(filePath);
    if (content === undefined) return;

    for (const decl of parseDeclarations(content)) {
      // ── Relative import → follow locally ──────────────────────────────────
      if (isRelativeSpecifier(decl.specifier)) {
        const resolved = resolveLocalFile(decl.specifier, filePath, contentMap);
        if (resolved) visit(resolved);
        continue;
      }

      if (isNodeBuiltin(decl.specifier)) continue;

      // ── TypeScript path alias → resolve and follow locally ────────────────
      if (tsConfigPaths) {
        const aliased = resolveAliasedSpecifier(decl.specifier, tsConfigPaths, contentMap);
        if (aliased) {
          visit(aliased);
          continue;
        }
      }

      // ── External package ──────────────────────────────────────────────────
      const pkg = normalizePackageName(decl.specifier);

      if (options.ignore?.some((p) => matchesIgnorePattern(pkg, p))) continue;
      if (options.workspacePackages?.some((p) => matchesIgnorePattern(pkg, p))) continue;

      const via: 'direct' | 'reexport' = decl.kind === 'reexport' ? 'reexport' : 'direct';
      const key = `${pkg} ${filePath}`;
      let entry = occurrences.get(key);

      if (!entry) {
        entry = { package: pkg, file: filePath, specifiers: new Set(), via };
        occurrences.set(key, entry);
      } else if (via === 'direct') {
        // Direct import takes precedence over reexport for the same (package, file).
        entry.via = 'direct';
      }
      entry.specifiers.add(decl.specifier);
    }
  }

  for (const file of files) {
    visit(file);
  }

  // One PackageOccurrence per distinct (package, file, specifier) triple.
  const out: PackageOccurrence[] = [];
  for (const { package: pkg, file, specifiers, via } of occurrences.values()) {
    for (const specifier of specifiers) {
      out.push({ package: pkg, specifier, file, via });
    }
  }
  return out;
}

// ─── Local file resolver ──────────────────────────────────────────────────────

/**
 * Resolves a relative specifier to an absolute file path.
 * Uses the pre-built contentMap (Map lookup) instead of existsSync —
 * zero disk I/O during DFS traversal.
 */
function resolveLocalFile(
  specifier: string,
  fromFile: string,
  contentMap: Map<string, string>,
): string | null {
  const base = resolve(dirname(fromFile), specifier);

  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    const candidate = base + ext;
    if (contentMap.has(candidate)) return candidate;
  }

  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    const candidate = join(base, 'index' + ext);
    if (contentMap.has(candidate)) return candidate;
  }

  return null;
}

function matchesIgnorePattern(pkg: string, pattern: string): boolean {
  if (pattern.endsWith('/*')) return pkg.startsWith(pattern.slice(0, -2) + '/');
  return pkg === pattern;
}
