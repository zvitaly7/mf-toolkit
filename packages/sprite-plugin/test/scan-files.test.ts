import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { scanFiles } from '../src/analyzer/scan-files.js';

const TMP = join(import.meta.dirname, 'fixtures/scan-test');

beforeAll(async () => {
  await mkdir(join(TMP, 'src/components'), { recursive: true });
  await mkdir(join(TMP, 'node_modules/pkg'), { recursive: true });
  await mkdir(join(TMP, 'dist'), { recursive: true });

  await writeFile(join(TMP, 'src/app.ts'), '');
  await writeFile(join(TMP, 'src/components/Button.tsx'), '');
  await writeFile(join(TMP, 'node_modules/pkg/index.ts'), '');
  await writeFile(join(TMP, 'dist/bundle.js'), '');
  await writeFile(join(TMP, 'src/styles.css'), '');
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe('scanFiles', () => {
  it('finds source files recursively', async () => {
    const files = await scanFiles([join(TMP, 'src')]);

    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith('app.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('Button.tsx'))).toBe(true);
  });

  it('excludes node_modules', async () => {
    const files = await scanFiles([TMP]);

    const nodeModulesFiles = files.filter((f) => f.includes('node_modules'));
    expect(nodeModulesFiles).toHaveLength(0);
  });

  it('excludes dist directory', async () => {
    const files = await scanFiles([TMP]);

    const distFiles = files.filter((f) => f.includes('dist'));
    expect(distFiles).toHaveLength(0);
  });

  it('filters by extensions', async () => {
    const tsxOnly = await scanFiles([join(TMP, 'src')], ['.tsx']);

    expect(tsxOnly).toHaveLength(1);
    expect(tsxOnly[0]).toContain('Button.tsx');
  });

  it('ignores non-matching extensions', async () => {
    const files = await scanFiles([join(TMP, 'src')]);

    const cssFiles = files.filter((f) => f.endsWith('.css'));
    expect(cssFiles).toHaveLength(0);
  });

  it('handles non-existent directories gracefully', async () => {
    const files = await scanFiles(['/does/not/exist']);
    expect(files).toHaveLength(0);
  });

  it('merges results from multiple directories', async () => {
    const files = await scanFiles([
      join(TMP, 'src'),
      join(TMP, 'src/components'),
    ]);

    // app.ts from src/, Button.tsx from both src/ (recursive) and src/components/
    expect(files.length).toBeGreaterThanOrEqual(2);
  });
});
