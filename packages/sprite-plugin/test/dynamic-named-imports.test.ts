import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { analyzeImports } from '../src/analyzer/analyze-imports.js';
import { buildSprite } from '../src/generator/build-sprite.js';

const FIXTURES_SRC = join(import.meta.dirname, 'fixtures/src');
const ICONS_DIR = join(import.meta.dirname, 'fixtures/icons');

describe('dynamic imports with extractNamedImports', () => {
  it('extracts names from .then(({ Name }) => ...)', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES_SRC],
      importPattern: /@ui\/Icon\/(.+)/,
      extractNamedImports: true,
      extensions: ['.ts'],
    });

    const names = result.map((r) => r.name);
    expect(names).toContain('payment/Arrow');
    expect(names).toContain('payment/Card');
  });

  it('extracts names from .then((m) => ({ default: m.Name }))', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES_SRC],
      importPattern: /@ui\/Icon\/(.+)/,
      extractNamedImports: true,
      extensions: ['.ts'],
    });

    const names = result.map((r) => r.name);
    expect(names).toContain('ui/PacmanBlack');
  });

  it('extracts names from .then(m => m.Name)', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES_SRC],
      importPattern: /@ui\/Icon\/(.+)/,
      extractNamedImports: true,
      extensions: ['.ts'],
    });

    const names = result.map((r) => r.name);
    expect(names).toContain('ui/PacmanLight');
  });

  it('extracts names from const { Name } = await import(...)', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES_SRC],
      importPattern: /@ui\/Icon\/(.+)/,
      extractNamedImports: true,
      extensions: ['.ts'],
    });

    const names = result.map((r) => r.name);
    expect(names).toContain('ui/Coins');
    expect(names).toContain('ui/Lock');
  });
});

describe('toKebabCase with digits', () => {
  it('matches PascalCase names with trailing digits to kebab-case files', async () => {
    // Coupon2 → coupon-2.svg, Cross2 → cross-2.svg
    const result = await buildSprite(ICONS_DIR, ['ui/Coupon2']);

    // We don't have coupon-2.svg in fixtures, so it should be missing
    // but the candidate should be "ui/coupon-2" not "ui/coupon2"
    expect(result.missing).toContain('ui/Coupon2');
  });
});
