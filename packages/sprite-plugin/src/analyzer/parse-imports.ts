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
 * Regex patterns to extract module specifiers from source code.
 *
 * Matches:
 *   import { X } from 'module'
 *   import X from 'module'
 *   import * as X from 'module'
 *   export { X } from 'module'
 *   import('module')
 *   require('module')
 */
const IMPORT_PATTERNS = [
  /(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export async function parseFileImports(
  filePath: string,
  iconPattern: RegExp,
): Promise<IconUsage[]> {
  const raw = await readFile(filePath, 'utf-8');
  const source = normalizeImports(stripComments(raw));
  const lines = source.split('\n');
  const results: IconUsage[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    for (const pattern of IMPORT_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        const moduleSpecifier = match[1];

        // Reset iconPattern state if it has global flag
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

  return results;
}
