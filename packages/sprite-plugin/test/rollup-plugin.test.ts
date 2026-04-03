import { describe, it, expect, afterEach, vi } from 'vitest';
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

const watchedFiles: string[] = [];
const pluginContext = {
  addWatchFile(id: string) { watchedFiles.push(id); },
};

afterEach(async () => {
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  watchedFiles.length = 0;
});

describe('mfSpriteRollupPlugin', () => {
  it('returns a plugin with correct name', () => {
    const plugin = mfSpriteRollupPlugin(BASE_OPTIONS);
    expect(plugin.name).toBe('mf-sprite');
  });

  it('generates sprite on buildStart', async () => {
    const plugin = mfSpriteRollupPlugin(BASE_OPTIONS);
    await plugin.buildStart.call(pluginContext);

    const content = await readFile(OUTPUT_FILE, 'utf-8');
    expect(content).toContain('injectSprite');
    expect(content).toContain('<symbol');
  });

  it('registers SVG files with addWatchFile on buildStart', async () => {
    const plugin = mfSpriteRollupPlugin(BASE_OPTIONS);
    await plugin.buildStart.call(pluginContext);

    expect(watchedFiles.length).toBeGreaterThan(0);
    expect(watchedFiles.every((f) => f.endsWith('.svg'))).toBe(true);
  });

  it('regenerates sprite on watchChange for iconsDir file', async () => {
    const plugin = mfSpriteRollupPlugin(BASE_OPTIONS);
    await plugin.buildStart.call(pluginContext);

    await plugin.watchChange(join(FIXTURES, 'icons/cart.svg'));
    const after = await readFile(OUTPUT_FILE, 'utf-8');
    expect(after).toContain('injectSprite');
  });

  it('does not regenerate on unrelated file change', async () => {
    const plugin = mfSpriteRollupPlugin(BASE_OPTIONS);
    await plugin.buildStart.call(pluginContext);

    const before = await readFile(OUTPUT_FILE, 'utf-8');
    await plugin.watchChange('/some/unrelated/file.ts');
    const after = await readFile(OUTPUT_FILE, 'utf-8');

    expect(after).toBe(before);
  });

  it('regenerates sprite on watchChange for sourceDirs file', async () => {
    const plugin = mfSpriteRollupPlugin(BASE_OPTIONS);
    await plugin.buildStart.call(pluginContext);

    await plugin.watchChange(join(FIXTURES, 'src/app.tsx'));
    const content = await readFile(OUTPUT_FILE, 'utf-8');
    expect(content).toContain('injectSprite');
  });

  it('logs a warning and does not throw when generation fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const plugin = mfSpriteRollupPlugin({
      ...BASE_OPTIONS,
      iconsDir: '/nonexistent/path',
    });

    await expect(plugin.buildStart.call(pluginContext)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('mf-sprite'), expect.anything());

    warnSpy.mockRestore();
  });
});
