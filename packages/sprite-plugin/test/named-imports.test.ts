import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { analyzeImports } from '../src/analyzer/analyze-imports.js';
import { buildSprite } from '../src/generator/build-sprite.js';

const FIXTURES_SRC = join(import.meta.dirname, 'fixtures/src');
const ICONS_DIR = join(import.meta.dirname, 'fixtures/icons');

describe('named imports mode', () => {
  it('extracts icon names from named imports', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES_SRC],
      importPattern: /@ui\/Icon\/.+/,
      extractNamedImports: true,
      extensions: ['.ts'],
    });

    const names = result.map((r) => r.name);
    expect(names).toContain('Cart');
    expect(names).toContain('Search');
  });

  it('extracts type imports in named mode', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES_SRC],
      importPattern: /@ui\/Icon\/.+/,
      extractNamedImports: true,
      extensions: ['.ts'],
    });

    const names = result.map((r) => r.name);
    expect(names).toContain('Star');
  });

  it('does not extract named imports when mode is off', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES_SRC],
      importPattern: /@ui\/Icon\/(.+)/,
      extractNamedImports: false,
      extensions: ['.ts'],
    });

    const names = result.map((r) => r.name);
    // Should extract "ui" and "other" from path, not "Cart", "Search"
    expect(names).not.toContain('Cart');
    expect(names).not.toContain('Search');
  });

  it('handles import aliases — takes original name', async () => {
    const result = await analyzeImports({
      sourceDirs: [FIXTURES_SRC],
      importPattern: /@ui\/Icon\/.+/,
      extractNamedImports: true,
      extensions: ['.ts'],
    });

    // Even if there were aliases like "Cart as MyCart", we'd get "Cart"
    const names = result.map((r) => r.name);
    expect(names).toContain('Cart');
  });
});

describe('PascalCase to kebab-case matching', () => {
  it('matches PascalCase import to kebab-case SVG file', async () => {
    // "Cart" should match "cart.svg", "Search" should match "search.svg"
    const result = await buildSprite(ICONS_DIR, ['Cart', 'Search']);

    expect(result.included).toContain('cart');
    expect(result.included).toContain('search');
    expect(result.missing).toHaveLength(0);
  });

  it('matches exact lowercase names', async () => {
    const result = await buildSprite(ICONS_DIR, ['cart', 'search']);

    expect(result.included).toContain('cart');
    expect(result.included).toContain('search');
  });

  it('reports missing for non-existent icons', async () => {
    const result = await buildSprite(ICONS_DIR, ['ChevronRight']);

    // No chevron-right.svg in fixtures
    expect(result.missing).toContain('ChevronRight');
  });

  it('deduplicates when PascalCase and lowercase refer to same file', async () => {
    const result = await buildSprite(ICONS_DIR, ['Cart', 'cart']);

    expect(result.included).toHaveLength(1);
    expect(result.included).toContain('cart');
  });
});
