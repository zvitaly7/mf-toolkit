import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { mfSpriteVitePlugin } from '../src/plugins/vite.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const OUTPUT_DIR = join(import.meta.dirname, 'fixtures/output');
const OUTPUT_FILE = join(OUTPUT_DIR, 'sprite.ts');

const BASE_OPTIONS = {
  iconsDir: join(FIXTURES, 'icons'),
  sourceDirs: [join(FIXTURES, 'src')],
  importPattern: /@my-ui\/icons\/(.+)/,
  output: OUTPUT_FILE,
  extensions: ['.tsx'],
};

afterEach(async () => {
  await rm(OUTPUT_DIR, { recursive: true, force: true });
});

describe('mfSpriteVitePlugin', () => {
  it('returns a plugin with correct name', () => {
    const plugin = mfSpriteVitePlugin(BASE_OPTIONS);
    expect(plugin.name).toBe('mf-sprite-vite');
  });

  it('generates sprite on buildStart', async () => {
    const plugin = mfSpriteVitePlugin(BASE_OPTIONS);
    await plugin.buildStart();

    const content = await readFile(OUTPUT_FILE, 'utf-8');
    expect(content).toContain('injectSprite');
    expect(content).toContain('<symbol');
  });

  it('regenerates sprite on handleHotUpdate for iconsDir file', async () => {
    const plugin = mfSpriteVitePlugin(BASE_OPTIONS);
    await plugin.buildStart();

    await plugin.handleHotUpdate({ file: join(FIXTURES, 'icons/cart.svg') });
    const content = await readFile(OUTPUT_FILE, 'utf-8');
    expect(content).toContain('injectSprite');
  });

  it('does not regenerate on unrelated file in handleHotUpdate', async () => {
    const plugin = mfSpriteVitePlugin(BASE_OPTIONS);
    await plugin.buildStart();

    const before = await readFile(OUTPUT_FILE, 'utf-8');
    await plugin.handleHotUpdate({ file: '/some/unrelated/file.ts' });
    const after = await readFile(OUTPUT_FILE, 'utf-8');

    expect(after).toBe(before);
  });
});
