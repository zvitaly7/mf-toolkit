import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildSprite } from '../src/generator/build-sprite.js';

const ICONS_DIR = join(import.meta.dirname, 'fixtures/icons');

describe('buildSprite', () => {
  it('builds sprite with requested icons', async () => {
    const result = await buildSprite(ICONS_DIR, ['cart', 'search']);

    expect(result.included).toContain('cart');
    expect(result.included).toContain('search');
    expect(result.missing).toHaveLength(0);
    expect(result.svg).toContain('<symbol id="cart"');
    expect(result.svg).toContain('<symbol id="search"');
  });

  it('reports missing icons', async () => {
    const result = await buildSprite(ICONS_DIR, ['cart', 'nonexistent']);

    expect(result.included).toContain('cart');
    expect(result.missing).toContain('nonexistent');
  });

  it('replaces colors with currentColor', async () => {
    const result = await buildSprite(ICONS_DIR, ['cart']);

    expect(result.svg).toContain('currentColor');
    expect(result.svg).not.toContain('#000000');
  });

  it('handles rgb colors in CSS', async () => {
    const result = await buildSprite(ICONS_DIR, ['search']);

    expect(result.svg).toContain('currentColor');
  });

  it('handles colors inside style blocks', async () => {
    const result = await buildSprite(ICONS_DIR, ['star']);

    expect(result.svg).toContain('currentColor');
  });

  it('returns empty sprite for no icons', async () => {
    const result = await buildSprite(ICONS_DIR, []);

    expect(result.included).toHaveLength(0);
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('</svg>');
  });

  it('throws on non-existent icons directory', async () => {
    await expect(buildSprite('/nonexistent', ['cart'])).rejects.toThrow(
      'Icons directory not found',
    );
  });

  it('matches icon names case-insensitively', async () => {
    const result = await buildSprite(ICONS_DIR, ['Cart', 'SEARCH']);

    expect(result.included).toContain('cart');
    expect(result.included).toContain('search');
    expect(result.missing).toHaveLength(0);
  });

  it('preserves viewBox from source SVG', async () => {
    const result = await buildSprite(ICONS_DIR, ['cart']);

    expect(result.svg).toContain('viewBox="0 0 24 24"');
  });

  it('wraps each icon in a <symbol> element', async () => {
    const result = await buildSprite(ICONS_DIR, ['cart', 'search', 'star']);

    const symbolCount = (result.svg.match(/<symbol /g) || []).length;
    expect(symbolCount).toBe(3);
  });

  it('wraps all symbols in a root <svg>', async () => {
    const result = await buildSprite(ICONS_DIR, ['cart']);

    expect(result.svg).toMatch(/^<svg[^>]*>/);
    expect(result.svg).toMatch(/<\/svg>$/);
  });

  it('returns byte sizes for each included icon', async () => {
    const result = await buildSprite(ICONS_DIR, ['cart', 'search']);

    expect(result.sizes.has('cart')).toBe(true);
    expect(result.sizes.has('search')).toBe(true);

    const cartSize = result.sizes.get('cart')!;
    expect(cartSize.originalBytes).toBeGreaterThan(0);
    expect(cartSize.sizeBytes).toBeGreaterThan(0);
    // SVGO should reduce the size
    expect(cartSize.originalBytes).toBeGreaterThanOrEqual(cartSize.sizeBytes);
  });

  it('does not include sizes for missing icons', async () => {
    const result = await buildSprite(ICONS_DIR, ['cart', 'nonexistent']);

    expect(result.sizes.has('cart')).toBe(true);
    expect(result.sizes.has('nonexistent')).toBe(false);
  });

  it('prefixes internal IDs to prevent collisions between icons', async () => {
    const result = await buildSprite(ICONS_DIR, ['gradient-icon']);

    // Internal ID "grad1" should be prefixed with the symbol ID
    expect(result.svg).toContain('id="gradient_icon--');
    expect(result.svg).toContain('url(#gradient_icon--');
    // The symbol ID itself should NOT be prefixed
    expect(result.svg).toContain('id="gradient-icon"');
  });
});
