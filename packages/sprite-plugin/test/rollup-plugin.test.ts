import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { mfSpriteRollupPlugin } from '../src/plugins/rollup.js';

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

describe('mfSpriteRollupPlugin', () => {
  it('returns a plugin with correct name', () => {
    const plugin = mfSpriteRollupPlugin(BASE_OPTIONS);
    expect(plugin.name).toBe('mf-sprite');
  });

  it('generates sprite on buildStart', async () => {
    const plugin = mfSpriteRollupPlugin(BASE_OPTIONS);
    await plugin.buildStart();

    const content = await readFile(OUTPUT_FILE, 'utf-8');
    expect(content).toContain('injectSprite');
    expect(content).toContain('<symbol');
  });

  it('regenerates sprite on watchChange for iconsDir file', async () => {
    const plugin = mfSpriteRollupPlugin(BASE_OPTIONS);
    await plugin.buildStart();

    const before = await readFile(OUTPUT_FILE, 'utf-8');

    await plugin.watchChange(join(FIXTURES, 'icons/cart.svg'));
    const after = await readFile(OUTPUT_FILE, 'utf-8');

    expect(after).toContain('injectSprite');
    expect(after).toBe(before); // same content, regenerated cleanly
  });

  it('does not regenerate on unrelated file change', async () => {
    const plugin = mfSpriteRollupPlugin(BASE_OPTIONS);
    await plugin.buildStart();

    const statBefore = (await readFile(OUTPUT_FILE, 'utf-8')).length;
    await plugin.watchChange('/some/unrelated/file.ts');
    const statAfter = (await readFile(OUTPUT_FILE, 'utf-8')).length;

    expect(statAfter).toBe(statBefore);
  });
});
