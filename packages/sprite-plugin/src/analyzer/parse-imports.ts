import { readFile } from 'node:fs/promises';
import type { IconUsage } from '../types.js';

/**
 * Strips single-line (//) and block comments from source code.
 * Preserves strings to avoid stripping comment-like content inside them.
 */
function stripComments(source: string): string {
  let result = '';
  let i = 0;

  while (i < source.length) {
    // String literals — skip through without modifying
    if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i];
      result += source[i++];
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          result += source[i++]; // skip escape char
        }
        if (i < source.length) {
          result += source[i++];
        }
      }
      if (i < source.length) {
        result += source[i++]; // closing quote
      }
    }
    // Block comment /* ... */
    else if (source[i] === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        i++;
      }
      i += 2; // skip */
      result += ' '; // replace with space to preserve token separation
    }
    // Single-line comment // ...
    else if (source[i] === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') {
        i++;
      }
    }
    // Regular character
    else {
      result += source[i++];
    }
  }

  return result;
}

/**
 * Normalizes multiline import/export statements into single lines.
 *
 * Transforms:
 *   import {
 *     CartIcon
 *   } from '@ui/icons/cart'
 *
 * Into:
 *   import { CartIcon } from '@ui/icons/cart'
 */
function normalizeImports(source: string): string {
  return source.replace(
    /(?:import|export)\s[\s\S]*?from\s+['"][^'"]+['"]/g,
    (match) => match.replace(/\s+/g, ' '),
  );
}

/**
 * Extracts named imports from an import statement.
 *
 * "import { ChevronRight, Cart as MyCart } from 'module'"
 *  → ["ChevronRight", "Cart"]
 *
 * "import type { Icon } from 'module'"
 *  → ["Icon"]
 */
function extractNamedImports(importStatement: string): string[] {
  const braceMatch = importStatement.match(/\{([^}]+)\}/);
  if (!braceMatch) return [];

  return braceMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      // Handle "type X" (inline type imports)
      const withoutType = s.replace(/^type\s+/, '');
      // Handle "X as Y" — take the original name X
      return withoutType.split(/\s+as\s+/)[0].trim();
    })
    .filter((s) => s.length > 0);
}

/**
 * Regex patterns to extract full import statements and module specifiers.
 *
 * Group 0: full match
 * Group 1: module specifier
 */
const STATIC_IMPORT_PATTERN =
  /(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]/g;

const DYNAMIC_IMPORT_PATTERNS = [
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export async function parseFileImports(
  filePath: string,
  iconPattern: RegExp,
  extractNamed = false,
): Promise<IconUsage[]> {
  const raw = await readFile(filePath, 'utf-8');
  const source = normalizeImports(stripComments(raw));
  const lines = source.split('\n');
  const results: IconUsage[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    // Static imports — support both path-based and named-import extraction
    const staticRegex = new RegExp(STATIC_IMPORT_PATTERN.source, STATIC_IMPORT_PATTERN.flags);
    let match: RegExpExecArray | null;

    while ((match = staticRegex.exec(line)) !== null) {
      const moduleSpecifier = match[1];

      iconPattern.lastIndex = 0;
      const iconMatch = iconPattern.exec(moduleSpecifier);

      if (!iconMatch) continue;

      if (extractNamed) {
        // Named import mode: extract icon names from { ... }
        // If importPattern has a capture group, use it as a path prefix
        const prefix = iconMatch[1] || '';
        const names = extractNamedImports(match[0]);
        for (const name of names) {
          results.push({
            name: prefix ? `${prefix}/${name}` : name,
            source: filePath,
            line: lineIndex + 1,
          });
        }
      } else if (iconMatch[1]) {
        // Path mode: extract icon name from capture group in module specifier
        results.push({
          name: iconMatch[1],
          source: filePath,
          line: lineIndex + 1,
        });
      }
    }

    // Dynamic imports — only path-based extraction (no named imports possible)
    if (!extractNamed) {
      for (const pattern of DYNAMIC_IMPORT_PATTERNS) {
        const regex = new RegExp(pattern.source, pattern.flags);

        while ((match = regex.exec(line)) !== null) {
          const moduleSpecifier = match[1];

          iconPattern.lastIndex = 0;
          const iconMatch = iconPattern.exec(moduleSpecifier);

          if (iconMatch && iconMatch[1]) {
            results.push({
              name: iconMatch[1],
              source: filePath,
              line: lineIndex + 1,
            });
          }
        }
      }
    }
  }

  return results;
}
