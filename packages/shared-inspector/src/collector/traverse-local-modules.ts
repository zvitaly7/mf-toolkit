import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import type { PackageOccurrence } from '../types.js';
import { scanFiles } from './collect-imports.js';
import {
  parseDeclarations,
  isRelativeSpecifier,
  isNodeBuiltin,
  normalizePackageName,
} from './parse-declarations.js';

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

export interface TraverseLocalModulesOptions {
  sourceDirs: string[];
  extensions?: string[];
  ignore?: string[];
}

/**
 * Local-graph mode collector.
 *
 * Scans all files in sourceDirs and follows relative import/export chains
 * recursively within those directories. Finds external packages reachable
 * through barrel re-exports and local module wrappers.
 *
 * Differences from collectImports (direct mode):
 *  - Counts both `import` AND `export { X } from 'pkg'` / `export * from 'pkg'`
 *  - Marks re-exported packages with via: 'reexport'
 *  - Follows relative specifiers within sourceDirs (DFS with visited cache)
 *
 * Uses readFileSync for synchronous DFS — acceptable for a build-time tool.
 */
export async function traverseLocalModules(
  options: TraverseLocalModulesOptions,
): Promise<PackageOccurrence[]> {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const files = await scanFiles(options.sourceDirs, extensions);

  const visited = new Set<string>();
  /** package → { files observed in, via: direct | reexport } */
  const pkgMap = new Map<string, { files: Set<string>; via: 'direct' | 'reexport' }>();

  function visit(filePath: string): void {
    if (visited.has(filePath)) return;
    visited.add(filePath);

    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    for (const decl of parseDeclarations(content)) {
      if (isRelativeSpecifier(decl.specifier)) {
        const resolved = resolveLocalFile(decl.specifier, filePath, options.sourceDirs);
        if (resolved) visit(resolved);
        continue;
      }

      if (isNodeBuiltin(decl.specifier)) continue;

      const pkg = normalizePackageName(decl.specifier);
      if (options.ignore?.some((p) => matchesIgnorePattern(pkg, p))) continue;

      const via: 'direct' | 'reexport' = decl.kind === 'reexport' ? 'reexport' : 'direct';
      const existing = pkgMap.get(pkg);

      if (!existing) {
        pkgMap.set(pkg, { files: new Set([filePath]), via });
      } else {
        existing.files.add(filePath);
        // Direct import takes precedence: once seen as direct, stays direct
        if (via === 'direct') existing.via = 'direct';
      }
    }
  }

  for (const file of files) {
    visit(file);
  }

  // One PackageOccurrence per (package, file) pair — consistent with collectImports
  return Array.from(pkgMap.entries()).flatMap(([pkg, { files: fileSet, via }]) =>
    [...fileSet].map((file) => ({ package: pkg, file, via })),
  );
}

// ─── Local file resolver ──────────────────────────────────────────────────────

/**
 * Resolves a relative specifier to an absolute file path within sourceDirs.
 * Tries direct extensions, then index files. No tsconfig paths/baseUrl support.
 * Returns null if the file cannot be found or is outside sourceDirs.
 */
function resolveLocalFile(
  specifier: string,
  fromFile: string,
  sourceDirs: string[],
): string | null {
  const base = resolve(dirname(fromFile), specifier);

  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    const candidate = base + ext;
    if (existsSync(candidate) && isWithinSourceDirs(candidate, sourceDirs)) {
      return candidate;
    }
  }

  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    const candidate = join(base, 'index' + ext);
    if (existsSync(candidate) && isWithinSourceDirs(candidate, sourceDirs)) {
      return candidate;
    }
  }

  return null;
}

function isWithinSourceDirs(filePath: string, sourceDirs: string[]): boolean {
  return sourceDirs.some(
    (dir) => filePath.startsWith(dir + sep) || filePath.startsWith(dir + '/'),
  );
}

function matchesIgnorePattern(pkg: string, pattern: string): boolean {
  if (pattern.endsWith('/*')) return pkg.startsWith(pattern.slice(0, -2) + '/');
  return pkg === pattern;
}
