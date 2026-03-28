/**
 * Shared low-level parser: extracts import/export specifiers from JS/TS source.
 * Used by both collect-imports (direct mode) and traverse-local-modules (local-graph).
 *
 * Adapted from packages/sprite-plugin/src/analyzer/parse-imports.ts.
 */

export type DeclarationKind = 'import' | 'reexport';

export interface Declaration {
  specifier: string;
  kind: DeclarationKind;
}

// ─── Node.js built-ins ────────────────────────────────────────────────────────

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads',
  'zlib',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

export function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith('node:')) return true;
  return NODE_BUILTINS.has(specifier.split('/')[0]);
}

/**
 * Normalizes a module specifier to its package name.
 *   lodash/get        → lodash
 *   @scope/name/deep  → @scope/name
 *   react             → react
 */
export function normalizePackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
}

// ─── Source preprocessing ─────────────────────────────────────────────────────

/** Strips // and block comments while preserving string literals. */
function stripComments(source: string): string {
  let result = '';
  let i = 0;

  while (i < source.length) {
    if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i];
      result += source[i++];
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') result += source[i++];
        if (i < source.length) result += source[i++];
      }
      if (i < source.length) result += source[i++];
    } else if (source[i] === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      result += ' ';
    } else if (source[i] === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i++;
    } else {
      result += source[i++];
    }
  }

  return result;
}

/** Collapses multiline import/export statements to single lines. */
function normalizeMultiline(source: string): string {
  return source.replace(
    /(?:import|export)\s[\s\S]*?from\s+['"][^'"]+['"]/g,
    (match) => match.replace(/\s+/g, ' '),
  );
}

// ─── Regex patterns ───────────────────────────────────────────────────────────

/**
 * Static imports — excludes:
 *   - dynamic import('pkg')  via (?!\s*\()
 *   - type-only imports      via (?!\s+type[\s{])
 */
const STATIC_IMPORT_RE =
  /\bimport(?!\s*\()(?!\s+type[\s{])\s+(?:[^'"]*?\bfrom\s+)?['"]([^'"]+)['"]/gm;

/**
 * Re-exports — matches:
 *   export { X } from 'pkg'
 *   export * from 'pkg'
 * Excludes export type { X } from 'pkg' via (?!type[\s{])
 */
const REEXPORT_RE =
  /\bexport\s+(?!type[\s{])(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm;

/** CommonJS require — require('pkg') */
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

/** Dynamic import with a literal string — import('pkg') */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse all import/export declarations from JS/TS source text.
 * Returns one entry per specifier occurrence.
 */
export function parseDeclarations(fileContent: string): Declaration[] {
  const src = normalizeMultiline(stripComments(fileContent));
  const results: Declaration[] = [];

  const patterns: Array<[RegExp, DeclarationKind]> = [
    [STATIC_IMPORT_RE, 'import'],
    [REQUIRE_RE, 'import'],
    [DYNAMIC_IMPORT_RE, 'import'],
    [REEXPORT_RE, 'reexport'],
  ];

  for (const [pattern, kind] of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(src)) !== null) {
      results.push({ specifier: match[1], kind });
    }
  }

  return results;
}
