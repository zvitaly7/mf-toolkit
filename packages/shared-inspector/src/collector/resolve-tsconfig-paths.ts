import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

/**
 * Resolved tsconfig path aliases.
 * Each alias pattern maps to one or more local directory roots.
 *
 * Example tsconfig.json:
 *   { "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/*"] } } }
 *
 * Produces:
 *   { aliases: [{ pattern: '@app/', roots: ['/project/src/'] }] }
 */
export interface ResolvedTsConfigPaths {
  /** Absolute base directory (compilerOptions.baseUrl resolved against tsconfig location) */
  baseDir: string;
  aliases: Array<{
    /** The alias prefix without the trailing '*', e.g. '@app/' */
    pattern: string;
    /** Resolved absolute directory roots (trailing '*' stripped from each mapping) */
    roots: string[];
  }>;
}

/**
 * Loads tsconfig.json and extracts path alias mappings.
 * Returns null when tsconfig is absent, unreadable, or has no paths defined.
 *
 * Only handles the common `"alias/*": ["dir/*"]` wildcard pattern.
 * Exact aliases (no wildcard) are not currently supported.
 */
export function loadTsConfigPaths(tsconfigPath: string): ResolvedTsConfigPaths | null {
  if (!existsSync(tsconfigPath)) return null;

  let raw: string;
  try {
    raw = readFileSync(tsconfigPath, 'utf-8');
  } catch {
    return null;
  }

  // Strip single-line comments so JSON.parse can handle tsconfig files
  const stripped = raw.replace(/\/\/[^\n]*/g, '');
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return null;
  }

  const compilerOptions = config['compilerOptions'] as Record<string, unknown> | undefined;
  if (!compilerOptions) return null;

  const tsconfigDir = dirname(resolve(tsconfigPath));
  const baseUrl = typeof compilerOptions['baseUrl'] === 'string'
    ? resolve(tsconfigDir, compilerOptions['baseUrl'])
    : tsconfigDir;

  const rawPaths = compilerOptions['paths'] as Record<string, string[]> | undefined;
  if (!rawPaths || typeof rawPaths !== 'object') return null;

  const aliases: ResolvedTsConfigPaths['aliases'] = [];

  for (const [aliasPattern, mappings] of Object.entries(rawPaths)) {
    // Only handle wildcard aliases: "@alias/*" → ["dir/*"]
    if (!aliasPattern.endsWith('/*')) continue;
    if (!Array.isArray(mappings) || mappings.length === 0) continue;

    const prefix = aliasPattern.slice(0, -1); // "@alias/" (remove trailing *)
    const roots = mappings
      .filter((m): m is string => typeof m === 'string' && m.endsWith('/*'))
      .map((m) => join(baseUrl, m.slice(0, -1))); // resolve to absolute, remove trailing *

    if (roots.length > 0) {
      aliases.push({ pattern: prefix, roots });
    }
  }

  if (aliases.length === 0) return null;

  return { baseDir: baseUrl, aliases };
}

/**
 * Resolves a TypeScript path alias specifier to an absolute file path.
 * Returns null when the specifier does not match any alias or the file
 * cannot be found on disk.
 *
 * @param specifier  - e.g. '@app/components/Button'
 * @param paths      - result of loadTsConfigPaths
 * @param contentMap - pre-read file map; used for O(1) existence checks
 */
export function resolveAliasedSpecifier(
  specifier: string,
  paths: ResolvedTsConfigPaths,
  contentMap: Map<string, string>,
): string | null {
  for (const alias of paths.aliases) {
    if (!specifier.startsWith(alias.pattern)) continue;

    const rest = specifier.slice(alias.pattern.length); // 'components/Button'

    for (const root of alias.roots) {
      const base = join(root, rest); // '/project/src/components/Button'

      // Try direct extensions, then index files
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const candidate = base + ext;
        if (contentMap.has(candidate)) return candidate;
      }
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const candidate = join(base, 'index' + ext);
        if (contentMap.has(candidate)) return candidate;
      }
    }
  }

  return null;
}
