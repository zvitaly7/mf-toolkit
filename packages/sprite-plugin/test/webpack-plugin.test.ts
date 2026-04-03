import { describe, it, expect, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { MfSpriteWebpackPlugin } from '../src/plugins/webpack.js';

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

/** Minimal mock compiler that captures registered hooks and lets us invoke them */
function makeCompiler() {
  const hooks: Record<string, ((...args: unknown[]) => Promise<void>)[]> = {
    beforeCompile: [],
    watchRun: [],
  };

  return {
    hooks: {
      beforeCompile: {
        tapPromise(_name: string, fn: (...args: unknown[]) => Promise<void>) {
          hooks.beforeCompile.push(fn);
        },
      },
      watchRun: {
        tapPromise(_name: string, fn: (...args: unknown[]) => Promise<void>) {
          hooks.watchRun.push(fn);
        },
      },
    },
    trigger: {
      async beforeCompile() { for (const fn of hooks.beforeCompile) await fn({}); },
      async watchRun() { for (const fn of hooks.watchRun) await fn({}); },
    },
  };
}

afterEach(async () => {
  await rm(OUTPUT_DIR, { recursive: true, force: true });
});

describe('MfSpriteWebpackPlugin', () => {
  it('generates sprite on beforeCompile', async () => {
    const plugin = new MfSpriteWebpackPlugin(BASE_OPTIONS);
    const compiler = makeCompiler();
    plugin.apply(compiler);

    await compiler.trigger.beforeCompile();

    const content = await readFile(OUTPUT_FILE, 'utf-8');
    expect(content).toContain('injectSprite');
    expect(content).toContain('<symbol');
  });

  it('regenerates sprite on watchRun', async () => {
    const plugin = new MfSpriteWebpackPlugin(BASE_OPTIONS);
    const compiler = makeCompiler();
    plugin.apply(compiler);

    await compiler.trigger.beforeCompile();
    await compiler.trigger.watchRun();

    const content = await readFile(OUTPUT_FILE, 'utf-8');
    expect(content).toContain('injectSprite');
  });

  it('registers both beforeCompile and watchRun hooks', () => {
    const registered: string[] = [];
    const compiler = {
      hooks: {
        beforeCompile: { tapPromise(name: string) { registered.push('beforeCompile:' + name); } },
        watchRun: { tapPromise(name: string) { registered.push('watchRun:' + name); } },
      },
    };

    new MfSpriteWebpackPlugin(BASE_OPTIONS).apply(compiler as never);

    expect(registered).toHaveLength(2);
    expect(registered[0]).toContain('beforeCompile');
    expect(registered[1]).toContain('watchRun');
  });

  it('logs a warning and does not throw when generation fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const plugin = new MfSpriteWebpackPlugin({ ...BASE_OPTIONS, iconsDir: '/nonexistent/path' });
    const compiler = makeCompiler();
    plugin.apply(compiler);

    await expect(compiler.trigger.beforeCompile()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('MfSpritePlugin'), expect.anything());

    warnSpy.mockRestore();
  });
});
