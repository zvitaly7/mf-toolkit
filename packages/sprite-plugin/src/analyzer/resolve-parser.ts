import type { ParseFunction, ParserStrategy } from '../types.js';
import { parseFileImports as regexParser } from './parse-imports.js';

export async function resolveParser(strategy: ParserStrategy = 'regex'): Promise<ParseFunction> {
  if (strategy === 'regex') {
    return regexParser;
  }

  if (strategy === 'typescript') {
    try {
      await import('typescript');
    } catch {
      throw new Error(
        '[sprite] Parser strategy "typescript" requires the "typescript" package.\n' +
        'Install it: npm install -D typescript',
      );
    }
    const { parseFileImports } = await import('./parsers/typescript-parser.js');
    return parseFileImports;
  }

  if (strategy === 'babel') {
    try {
      await import('@babel/parser');
    } catch {
      throw new Error(
        '[sprite] Parser strategy "babel" requires the "@babel/parser" package.\n' +
        'Install it: npm install -D @babel/parser',
      );
    }
    const { parseFileImports } = await import('./parsers/babel-parser.js');
    return parseFileImports;
  }

  throw new Error(`[sprite] Unknown parser strategy: "${strategy}"`);
}
