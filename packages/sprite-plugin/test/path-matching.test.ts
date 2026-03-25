import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { analyzeImports } from '../src/analyzer/analyze-imports.js';
import { buildSprite } from '../src/generator/build-sprite.js';

const FIXTURES_SRC = join(import.meta.dirname, 'fixtures/src');
const ICONS_DIR = join(import.meta.dirname, 'fixtures/icons');

describe('path-based icon matching', () => {
  it('prefixes icon names with captured category', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES_SRC],
      importPattern: /@ui\/Icon\/(.+)/,
      extractNamedImports: true,
      extensions: ['.ts'],
    });

    const names = result.map((r) => r.name);
    expect(names).toContain('ui/Arrow');
    expect(names).toContain('payment/Arrow');
  });

  it('resolves same-name icons in different subdirectories', async () => {
    // ui/arrow.svg and payment/arrow.svg are different files
    const result = await buildSprite(ICONS_DIR, ['ui/Arrow', 'payment/Arrow']);

    expect(result.included).toContain('ui/arrow');
    expect(result.included).toContain('payment/arrow');
    expect(result.missing).toHaveLength(0);

    // Both symbols should be in the sprite with different IDs
    expect(result.svg).toContain('id="ui/arrow"');
    expect(result.svg).toContain('id="payment/arrow"');
  });

  it('falls back to basename when no prefix is given', async () => {
    const result = await buildSprite(ICONS_DIR, ['cart', 'search']);

    expect(result.included).toContain('cart');
    expect(result.included).toContain('search');
  });

  it('works without capture group (no prefix)', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES_SRC],
      importPattern: /@ui\/Icon\/.+/,  // no capture group
      extractNamedImports: true,
      extensions: ['.ts'],
    });

    const names = result.map((r) => r.name);
    // Without capture group, names have no prefix
    expect(names).toContain('Arrow');
  });
});
