import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { analyzeImports } from '../src/analyzer/analyze-imports.js';
import { resolveParser } from '../src/analyzer/resolve-parser.js';

const FIXTURES = join(import.meta.dirname, 'fixtures/src');
const PATH_PATTERN = /@my-ui\/icons\/(.+)/;
const NAMED_PATTERN = /@ui\/Icon\/.+/;

const strategies = ['regex', 'typescript', 'babel'] as const;

describe('parser strategy resolution', () => {
  it('defaults to regex', async () => {
    const parser = await resolveParser();
    expect(typeof parser).toBe('function');
  });

  it('resolves all strategies', async () => {
    for (const strategy of strategies) {
      const parser = await resolveParser(strategy);
      expect(typeof parser).toBe('function');
    }
  });

  it('throws on unknown strategy', async () => {
    await expect(resolveParser('unknown' as any)).rejects.toThrow('Unknown parser strategy');
  });
});

describe.each(strategies)('parser: %s — static path imports', (strategy) => {
  it('finds imports from .tsx files', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES],
      importPattern: PATH_PATTERN,
      extensions: ['.tsx'],
      parser: strategy,
    });

    const names = result.map((r) => r.name);
    expect(names).toContain('cart');
    expect(names).toContain('search');
  });

  it('finds multiline imports', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES],
      importPattern: PATH_PATTERN,
      extensions: ['.ts'],
      parser: strategy,
    });

    const names = result.map((r) => r.name);
    expect(names).toContain('star');
  });

  it('ignores commented imports', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES],
      importPattern: PATH_PATTERN,
      extensions: ['.ts'],
      parser: strategy,
    });

    const names = result.map((r) => r.name);
    expect(names).not.toContain('hidden');
  });

  it('tracks line numbers', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES],
      importPattern: PATH_PATTERN,
      extensions: ['.tsx'],
      parser: strategy,
    });

    for (const usage of result) {
      expect(usage.line).toBeGreaterThan(0);
      expect(usage.source).toBeTruthy();
    }
  });
});

describe.each(strategies)('parser: %s — named imports', (strategy) => {
  it('extracts named imports', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES],
      importPattern: NAMED_PATTERN,
      extractNamedImports: true,
      extensions: ['.ts'],
      parser: strategy,
    });

    const names = result.map((r) => r.name);
    expect(names).toContain('Cart');
    expect(names).toContain('Search');
  });
});

describe.each(strategies)('parser: %s — dynamic imports', (strategy) => {
  it('finds dynamic import paths', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES],
      importPattern: PATH_PATTERN,
      extensions: ['.ts'],
      parser: strategy,
    });

    const names = result.map((r) => r.name);
    // dynamic.ts has: import('@my-ui/icons/star')
    expect(names).toContain('star');
  });
});
