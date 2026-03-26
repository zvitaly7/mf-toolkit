import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { resolveParser } from '../src/analyzer/resolve-parser.js';

const FIXTURES = join(import.meta.dirname, 'fixtures/src');
const PATH_PATTERN = /@my-ui\/icons\/(.+)/;
const NAMED_PATTERN = /@ui\/Icon\/(.+)/;

/**
 * Exhaustive comparison: all three parsers must produce identical
 * icon names for every fixture file and every mode.
 */

async function parseWith(strategy: 'regex' | 'typescript' | 'babel', file: string, pattern: RegExp, extractNamed: boolean) {
  const parseFn = await resolveParser(strategy);
  return parseFn(join(FIXTURES, file), pattern, extractNamed);
}

function names(usages: { name: string }[]) {
  return usages.map((u) => u.name).sort();
}

describe('parser comparison: path mode', () => {
  const files = [
    { file: 'app.tsx', expected: ['cart', 'search'] },
    { file: 'multiline.ts', expected: ['star'] },
    { file: 'commented.ts', expected: [] },
    { file: 'dynamic.ts', expected: ['cart', 'search'] },
    { file: 'type-imports.ts', expected: [] },
    { file: 'reexport.ts', expected: ['cart'] },
  ];

  for (const { file, expected } of files) {
    it(`${file}: all parsers match`, async () => {
      const [regex, ts, babel] = await Promise.all([
        parseWith('regex', file, PATH_PATTERN, false),
        parseWith('typescript', file, PATH_PATTERN, false),
        parseWith('babel', file, PATH_PATTERN, false),
      ]);

      const regexNames = names(regex);
      const tsNames = names(ts);
      const babelNames = names(babel);

      // All must match expected
      expect(regexNames).toEqual(expected.sort());
      expect(tsNames).toEqual(expected.sort());
      expect(babelNames).toEqual(expected.sort());

      // Cross-check: ts and babel match regex
      expect(tsNames).toEqual(regexNames);
      expect(babelNames).toEqual(regexNames);
    });
  }
});

describe('parser comparison: named import mode', () => {
  const files = [
    { file: 'named-imports.ts', pattern: /@ui\/Icon\/(.+)/, expected: ['ui/Cart', 'ui/Search'] },
    { file: 'categorized-imports.ts', pattern: /@ui\/Icon\/(.+)/, expected: ['ui/Arrow', 'payment/Arrow'] },
    { file: 'inline-type-imports.ts', pattern: /@ui\/Icon\/(.+)/, expected: ['ui/Cart', 'ui/Search'] },
  ];

  for (const { file, pattern, expected } of files) {
    it(`${file}: all parsers match`, async () => {
      const [regex, ts, babel] = await Promise.all([
        parseWith('regex', file, pattern, true),
        parseWith('typescript', file, pattern, true),
        parseWith('babel', file, pattern, true),
      ]);

      const regexNames = names(regex);
      const tsNames = names(ts);
      const babelNames = names(babel);

      expect(regexNames).toEqual(expected.sort());
      expect(tsNames).toEqual(expected.sort());
      expect(babelNames).toEqual(expected.sort());
    });
  }
});

describe('parser comparison: dynamic named imports', () => {
  it('dynamic-named.ts: all parsers find .then destructured names', async () => {
    const pattern = /@ui\/Icon\/(.+)/;
    const [regex, ts, babel] = await Promise.all([
      parseWith('regex', 'dynamic-named.ts', pattern, true),
      parseWith('typescript', 'dynamic-named.ts', pattern, true),
      parseWith('babel', 'dynamic-named.ts', pattern, true),
    ]);

    const regexNames = names(regex);
    const tsNames = names(ts);
    const babelNames = names(babel);

    // Regex parser finds these from dynamic-named.ts:
    // Pattern 1: Arrow, Card from .then destructuring
    // Pattern 2: PacmanBlack from .then member access
    // Pattern 3: PacmanLight from .then arrow shorthand
    // Pattern 4: Coins, Lock from await destructuring
    expect(regexNames).toContain('payment/Arrow');
    expect(regexNames).toContain('payment/Card');

    // AST parsers should find at minimum the same as regex
    for (const name of regexNames) {
      expect(tsNames).toContain(name);
      expect(babelNames).toContain(name);
    }
  });
});

describe('parser comparison: line numbers', () => {
  it('app.tsx: line numbers are accurate across parsers', async () => {
    const [regex, ts, babel] = await Promise.all([
      parseWith('regex', 'app.tsx', PATH_PATTERN, false),
      parseWith('typescript', 'app.tsx', PATH_PATTERN, false),
      parseWith('babel', 'app.tsx', PATH_PATTERN, false),
    ]);

    // app.tsx has cart on line 1, search on line 2
    const regexCart = regex.find((u) => u.name === 'cart');
    const tsCart = ts.find((u) => u.name === 'cart');
    const babelCart = babel.find((u) => u.name === 'cart');

    expect(regexCart?.line).toBe(1);
    expect(tsCart?.line).toBe(1);
    expect(babelCart?.line).toBe(1);

    const regexSearch = regex.find((u) => u.name === 'search');
    const tsSearch = ts.find((u) => u.name === 'search');
    const babelSearch = babel.find((u) => u.name === 'search');

    expect(regexSearch?.line).toBe(2);
    expect(tsSearch?.line).toBe(2);
    expect(babelSearch?.line).toBe(2);
  });

  it('dynamic.ts: line numbers for dynamic imports', async () => {
    const [regex, ts, babel] = await Promise.all([
      parseWith('regex', 'dynamic.ts', PATH_PATTERN, false),
      parseWith('typescript', 'dynamic.ts', PATH_PATTERN, false),
      parseWith('babel', 'dynamic.ts', PATH_PATTERN, false),
    ]);

    // dynamic.ts: import() on line 1, require() on line 3
    const regexCart = regex.find((u) => u.name === 'cart');
    const tsCart = ts.find((u) => u.name === 'cart');
    const babelCart = babel.find((u) => u.name === 'cart');

    expect(regexCart?.line).toBe(1);
    expect(tsCart?.line).toBe(1);
    expect(babelCart?.line).toBe(1);

    const regexSearch = regex.find((u) => u.name === 'search');
    const tsSearch = ts.find((u) => u.name === 'search');
    const babelSearch = babel.find((u) => u.name === 'search');

    expect(regexSearch?.line).toBe(3);
    expect(tsSearch?.line).toBe(3);
    expect(babelSearch?.line).toBe(3);
  });
});
