import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { resolveVersions } from '../../src/collector/resolve-versions.js';

const FIXTURES = join(import.meta.dirname, '../fixtures');

describe('resolveVersions — declared versions', () => {
  it('reads dependencies from package.json', async () => {
    const { declared } = await resolveVersions(
      join(FIXTURES, 'resolve-versions/package.json'),
    );

    expect(declared['react']).toBe('^19.0.0');
    expect(declared['mobx']).toBe('^6.12.0');
  });

  it('merges devDependencies into declared', async () => {
    const { declared } = await resolveVersions(
      join(FIXTURES, 'resolve-versions/package.json'),
    );

    expect(declared['typescript']).toBe('^5.0.0');
  });

  it('returns empty declared when package.json does not exist', async () => {
    const { declared } = await resolveVersions('/nonexistent/package.json');
    expect(declared).toEqual({});
  });

  it('includes all declared packages as keys', async () => {
    const { declared } = await resolveVersions(
      join(FIXTURES, 'resolve-versions/package.json'),
    );

    expect(Object.keys(declared)).toContain('react');
    expect(Object.keys(declared)).toContain('react-dom');
    expect(Object.keys(declared)).toContain('mobx');
    expect(Object.keys(declared)).toContain('typescript');
  });
});

describe('resolveVersions — installed versions', () => {
  it('reads installed version from node_modules', async () => {
    const { installed } = await resolveVersions(
      join(FIXTURES, 'resolve-versions/package.json'),
    );

    expect(installed['react']).toBe('19.1.0');
    expect(installed['mobx']).toBe('6.13.5');
  });

  it('skips packages absent from node_modules (installed stays empty for them)', async () => {
    const { installed } = await resolveVersions(
      join(FIXTURES, 'resolve-versions/package.json'),
    );

    // react-dom and typescript have no fake node_modules entry
    expect(installed['react-dom']).toBeUndefined();
    expect(installed['typescript']).toBeUndefined();
  });

  it('returns empty installed when node_modules does not exist', async () => {
    // mf-checkout fixture has no node_modules
    const { installed } = await resolveVersions(
      join(FIXTURES, 'mf-checkout/package.json'),
    );

    expect(installed).toEqual({});
  });

  it('installed is independent from declared — no fallback', async () => {
    const { declared, installed } = await resolveVersions(
      join(FIXTURES, 'resolve-versions/package.json'),
    );

    // installed must NOT copy from declared for missing packages
    expect(installed['react-dom']).not.toBe(declared['react-dom']);
    expect(installed['react-dom']).toBeUndefined();
  });
});
