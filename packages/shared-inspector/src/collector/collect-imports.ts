import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { PackageOccurrence } from '../types.js';
import {
  parseDeclarations,
  isRelativeSpecifier,
  isNodeBuiltin,
  normalizePackageName,
} from './parse-declarations.js';

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage'];

// ─── File scanner ─────────────────────────────────────────────────────────────

async function scanFiles(dirs: string[], extensions: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const dir of dirs) {
    try {
      const entries = await readdir(dir, { recursive: true });
      for (const entry of entries) {
        if (typeof entry !== 'string') continue;
        if (!extensions.includes(extname(entry))) continue;
        if (entry.split('/').some((seg) => IGNORED_DIRS.includes(seg))) continue;
        files.push(join(dir, entry));
      }
    } catch {
      // Directory does not exist — skip silently
    }
  }

  return files;
}

// ─── Collector options ────────────────────────────────────────────────────────

export interface CollectImportsOptions {
  sourceDirs: string[];
  extensions?: string[];
  ignore?: string[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Direct mode collector.
 *
 * Scans all source files and extracts explicitly imported package names.
 * Counts only `import` and `require` declarations — re-exports are NOT counted
 * (they are the domain of traverse-local-modules in local-graph mode).
 */
export async function collectImports(
  options: CollectImportsOptions,
): Promise<PackageOccurrence[]> {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const files = await scanFiles(options.sourceDirs, extensions);

  /** package → Set of files that import it */
  const pkgFiles = new Map<string, Set<string>>();

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, 'utf-8');
    } catch {
      continue;
    }

    const declarations = parseDeclarations(content);

    for (const decl of declarations) {
      // Direct mode: only explicit imports, no re-exports
      if (decl.kind !== 'import') continue;

      const { specifier } = decl;
      if (isRelativeSpecifier(specifier)) continue;
      if (isNodeBuiltin(specifier)) continue;

      const pkg = normalizePackageName(specifier);

      if (options.ignore?.some((pattern) => matchesIgnorePattern(pkg, pattern))) continue;

      if (!pkgFiles.has(pkg)) pkgFiles.set(pkg, new Set());
      pkgFiles.get(pkg)!.add(file);
    }
  }

  return Array.from(pkgFiles.entries()).map(([pkg, fileSet]) => ({
    package: pkg,
    file: [...fileSet][0], // primary file (first observed)
    via: 'direct' as const,
  }));
}

// ─── Ignore pattern matching ──────────────────────────────────────────────────

/** Supports exact match and simple glob: '@company/*' */
function matchesIgnorePattern(pkg: string, pattern: string): boolean {
  if (pattern.endsWith('/*')) {
    const scope = pattern.slice(0, -2);
    return pkg.startsWith(scope + '/');
  }
  return pkg === pattern;
}
