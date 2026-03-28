import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildProjectManifest } from '../../src/collector/build-project-manifest.js';

const FIXTURES = join(import.meta.dirname, '../fixtures');
const CHECKOUT_SRC = join(FIXTURES, 'mf-checkout/src');
const CHECKOUT_PKG = join(FIXTURES, 'mf-checkout/package.json');

const SHARED_CONFIG = {
  react: { singleton: true, requiredVersion: '^19.0.0' },
  'react-dom': { singleton: true },
  mobx: { singleton: true },
  lodash: {},
};

// ─── Direct mode ──────────────────────────────────────────────────────────────

describe('buildProjectManifest — direct mode', () => {
  it('produces a manifest with correct project metadata', async () => {
    const manifest = await buildProjectManifest({
      name: 'checkout',
      sourceDirs: [CHECKOUT_SRC],
      sharedConfig: SHARED_CONFIG,
      depth: 'direct',
      packageJsonPath: CHECKOUT_PKG,
    });

    expect(manifest.project.name).toBe('checkout');
    expect(manifest.project.kind).toBe('unknown');
    expect(manifest.schemaVersion).toBe(1);
  });

  it('records source depth as direct', async () => {
    const manifest = await buildProjectManifest({
      name: 'checkout',
      sourceDirs: [CHECKOUT_SRC],
      depth: 'direct',
      packageJsonPath: CHECKOUT_PKG,
    });

    expect(manifest.source.depth).toBe('direct');
  });

  it('counts scanned files', async () => {
    const manifest = await buildProjectManifest({
      name: 'checkout',
      sourceDirs: [CHECKOUT_SRC],
      depth: 'direct',
      packageJsonPath: CHECKOUT_PKG,
    });

    expect(manifest.source.filesScanned).toBeGreaterThan(0);
  });

  it('finds directly imported packages', async () => {
    const manifest = await buildProjectManifest({
      name: 'checkout',
      sourceDirs: [CHECKOUT_SRC],
      depth: 'direct',
      packageJsonPath: CHECKOUT_PKG,
    });

    expect(manifest.usage.resolvedPackages).toContain('react');
    expect(manifest.usage.resolvedPackages).toContain('react-router-dom');
    expect(manifest.usage.resolvedPackages).toContain('axios');
    expect(manifest.usage.resolvedPackages).toContain('lodash');
  });

  it('does NOT find packages hidden behind barrel re-exports', async () => {
    const manifest = await buildProjectManifest({
      name: 'checkout',
      sourceDirs: [CHECKOUT_SRC],
      sharedConfig: SHARED_CONFIG,
      depth: 'direct',
      packageJsonPath: CHECKOUT_PKG,
    });

    // mobx and mobx-react are only re-exported from src/shared/index.ts
    // direct mode cannot see through local module chains
    expect(manifest.usage.resolvedPackages).not.toContain('mobx');
    expect(manifest.usage.resolvedPackages).not.toContain('mobx-react');
  });

  it('directPackages and resolvedPackages are equal in direct mode', async () => {
    const manifest = await buildProjectManifest({
      name: 'checkout',
      sourceDirs: [CHECKOUT_SRC],
      depth: 'direct',
      packageJsonPath: CHECKOUT_PKG,
    });

    expect(manifest.usage.directPackages).toEqual(manifest.usage.resolvedPackages);
  });

  it('packageDetails has importCount equal to files.length', async () => {
    const manifest = await buildProjectManifest({
      name: 'checkout',
      sourceDirs: [CHECKOUT_SRC],
      depth: 'direct',
      packageJsonPath: CHECKOUT_PKG,
    });

    for (const detail of manifest.usage.packageDetails) {
      expect(detail.importCount).toBe(detail.files.length);
    }
  });

  it('all packageDetails entries have via: direct', async () => {
    const manifest = await buildProjectManifest({
      name: 'checkout',
      sourceDirs: [CHECKOUT_SRC],
      depth: 'direct',
      packageJsonPath: CHECKOUT_PKG,
    });

    expect(manifest.usage.packageDetails.every((d) => d.via === 'direct')).toBe(true);
  });

  it('includes normalised shared config', async () => {
    const manifest = await buildProjectManifest({
      name: 'checkout',
      sourceDirs: [CHECKOUT_SRC],
      sharedConfig: SHARED_CONFIG,
      depth: 'direct',
      packageJsonPath: CHECKOUT_PKG,
    });

    expect(manifest.shared.declared['react']?.singleton).toBe(true);
    expect(manifest.shared.declared['lodash']).toEqual({});
    expect(manifest.shared.source).toBe('explicit');
  });

  it('includes declared versions from package.json', async () => {
    const manifest = await buildProjectManifest({
      name: 'checkout',
      sourceDirs: [CHECKOUT_SRC],
      depth: 'direct',
      packageJsonPath: CHECKOUT_PKG,
    });

    expect(manifest.versions.declared['react']).toBe('19.0.0');
    expect(manifest.versions.declared['mobx']).toBe('^6.12.0');
  });

  it('manifest is serialisable to JSON without data loss', async () => {
    const manifest = await buildProjectManifest({
      name: 'checkout',
      sourceDirs: [CHECKOUT_SRC],
      sharedConfig: SHARED_CONFIG,
      depth: 'direct',
      packageJsonPath: CHECKOUT_PKG,
    });

    const roundtripped = JSON.parse(JSON.stringify(manifest));
    expect(roundtripped).toEqual(manifest);
  });
});

// ─── local-graph throws until implemented ────────────────────────────────────

describe('buildProjectManifest — local-graph (not yet implemented)', () => {
  it('throws when depth: local-graph is requested', async () => {
    await expect(
      buildProjectManifest({
        name: 'checkout',
        sourceDirs: [CHECKOUT_SRC],
        depth: 'local-graph',
        packageJsonPath: CHECKOUT_PKG,
      }),
    ).rejects.toThrow('local-graph');
  });
});
