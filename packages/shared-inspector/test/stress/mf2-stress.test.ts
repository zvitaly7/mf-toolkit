/**
 * Stress / real-world tests for the MF 2.0 manifest adapter and federation
 * pipeline that consumes adapted manifests.
 *
 * Covers:
 *   - 5-MF federation (1 host + 4 remotes) with mixed misconfigurations
 *   - Inherited shared (entry.from !== name) filtered consistently
 *   - Adapter robust to malformed/partial entries (skips, never throws)
 *   - Large shared list (50 packages) preserved end-to-end
 *   - Mixing native ProjectManifest and adapted MF 2.0 manifests
 *   - kind inference fallbacks across edge shapes
 */

import { describe, it, expect } from 'vitest';
import {
  isMf2Manifest,
  adaptMf2Manifest,
  type Mf2RawManifest,
} from '../../src/collector/read-mf2-manifest.js';
import { analyzeFederation } from '../../src/analyzer/analyze-federation.js';
import type { ProjectManifest } from '../../src/types.js';

// ─── Fixture builders ─────────────────────────────────────────────────────────

interface MakeMf2 {
  name: string;
  type?: 'app' | 'lib';
  shared?: Array<{
    name: string;
    version?: string;
    requiredVersion?: string;
    singleton?: boolean;
    eager?: boolean;
    from?: string;
  }>;
  remotes?: number;
  exposes?: number;
}

function makeMf2(opts: MakeMf2): Mf2RawManifest {
  return {
    id: `${opts.name}:1.0.0`,
    name: opts.name,
    metaData: opts.type ? { name: opts.name, type: opts.type } : { name: opts.name },
    shared: (opts.shared ?? []).map((s) => ({
      id: `${opts.name}:${s.name}`,
      from: s.from ?? opts.name,
      ...s,
    })),
    remotes: Array.from({ length: opts.remotes ?? 0 }, (_, i) => ({
      federationContainerName: `r${i}`,
      moduleName: 'X',
      alias: `r${i}`,
      entry: `https://example.com/r${i}/mf-manifest.json`,
    })),
    exposes: Array.from({ length: opts.exposes ?? 0 }, (_, i) => ({
      id: `${opts.name}:E${i}`,
      name: `E${i}`,
      path: `./E${i}`,
    })),
  };
}

// ─── 5-MF federation E2E ──────────────────────────────────────────────────────

describe('stress: 5-MF federation against MF 2.0 manifests', () => {
  // shell (host) shares react@18, zustand
  // checkout — react@17 (conflict), drops singleton on react-dom (mismatch)
  // cart — react@18 OK, ghost-shares lodash (no one else uses or shares it)
  // catalog — react@18 OK
  // wishlist — react@18 OK
  const shell = adaptMf2Manifest(makeMf2({
    name: 'shell', type: 'app', remotes: 4,
    shared: [
      { name: 'react', version: '18.2.0', singleton: true, requiredVersion: '^18.2.0' },
      { name: 'react-dom', version: '18.2.0', singleton: true, requiredVersion: '^18.2.0' },
      { name: 'zustand', version: '4.5.0', singleton: true, requiredVersion: '^4.0.0' },
    ],
  }));

  const checkout = adaptMf2Manifest(makeMf2({
    name: 'checkout', type: 'lib', exposes: 1,
    shared: [
      { name: 'react', version: '17.0.2', singleton: true, requiredVersion: '^17.0.2' },
      { name: 'react-dom', version: '17.0.2', requiredVersion: '^17.0.2' },
    ],
  }));

  const cart = adaptMf2Manifest(makeMf2({
    name: 'cart', type: 'lib', exposes: 1,
    shared: [
      { name: 'react', version: '18.2.0', singleton: true, requiredVersion: '^18.0.0' },
      { name: 'react-dom', version: '18.2.0', singleton: true, requiredVersion: '^18.0.0' },
      { name: 'lodash', version: '4.17.21' },
    ],
  }));

  const catalog = adaptMf2Manifest(makeMf2({
    name: 'catalog', type: 'lib', exposes: 1,
    shared: [
      { name: 'react', version: '18.2.0', singleton: true, requiredVersion: '^18.2.0' },
      { name: 'react-dom', version: '18.2.0', singleton: true, requiredVersion: '^18.2.0' },
    ],
  }));

  const wishlist = adaptMf2Manifest(makeMf2({
    name: 'wishlist', type: 'lib', exposes: 1,
    shared: [
      { name: 'react', version: '18.2.0', singleton: true, requiredVersion: '^18.2.0' },
      { name: 'react-dom', version: '18.2.0', singleton: true, requiredVersion: '^18.2.0' },
    ],
  }));

  const report = analyzeFederation([shell, checkout, cart, catalog, wishlist]);

  it('detects react version conflict (^17 vs ^18)', () => {
    const conflict = report.versionConflicts.find((c) => c.package === 'react');
    expect(conflict).toBeDefined();
    expect(conflict!.versions['shell']).toBe('^18.2.0');
    expect(conflict!.versions['checkout']).toBe('^17.0.2');
  });

  it('detects react-dom singleton mismatch (checkout omits singleton)', () => {
    const mm = report.singletonMismatches.find((m) => m.package === 'react-dom');
    expect(mm).toBeDefined();
    expect(mm!.singletonIn).toContain('shell');
    expect(mm!.singletonIn).toContain('cart');
    expect(mm!.nonSingletonIn).toContain('checkout');
  });

  it('detects zustand ghost share (only shell, no other MF uses or declares it)', () => {
    const ghost = report.ghostShares.find((g) => g.package === 'zustand');
    expect(ghost).toBeDefined();
    expect(ghost!.sharedBy).toBe('shell');
  });

  it('detects lodash ghost share (only cart, no other MF uses or declares it)', () => {
    const ghost = report.ghostShares.find((g) => g.package === 'lodash');
    expect(ghost).toBeDefined();
    expect(ghost!.sharedBy).toBe('cart');
  });

  it('summary reflects all categories at scale', () => {
    expect(report.summary.totalManifests).toBe(5);
    expect(report.summary.versionConflictsCount).toBeGreaterThan(0);
    expect(report.summary.singletonMismatchesCount).toBeGreaterThan(0);
    expect(report.summary.ghostSharesCount).toBeGreaterThanOrEqual(2);
  });
});

// ─── Inherited shared filtering ───────────────────────────────────────────────

describe('stress: inherited shared filtering across federation', () => {
  it('host-provided react entry inside a remote does not double-count', () => {
    const host = adaptMf2Manifest(makeMf2({
      name: 'host', type: 'app',
      shared: [{ name: 'react', version: '18.2.0', singleton: true, requiredVersion: '^18.2.0' }],
      remotes: 1,
    }));

    // Remote manifest contains BOTH locally declared lodash and an inherited
    // react entry whose `from` points at host. Adapter must drop the inherited.
    const remote = adaptMf2Manifest(makeMf2({
      name: 'remote', type: 'lib', exposes: 1,
      shared: [
        { name: 'lodash', version: '4.17.21' },
        { name: 'react', version: '18.2.0', singleton: true, requiredVersion: '^18.2.0', from: 'host' },
      ],
    }));

    expect(remote.shared.declared.react).toBeUndefined();
    expect(remote.shared.declared.lodash).toBeDefined();

    const report = analyzeFederation([host, remote]);
    // No singleton mismatch on react: only host declares it locally.
    expect(report.singletonMismatches.find((m) => m.package === 'react')).toBeUndefined();
    // No version conflict on react either.
    expect(report.versionConflicts.find((c) => c.package === 'react')).toBeUndefined();
  });
});

// ─── Robustness to malformed entries ─────────────────────────────────────────

describe('stress: adapter is defensive against malformed shared entries', () => {
  it('skips entries with non-string name and unknown shapes without throwing', () => {
    const raw = {
      name: 'lib',
      metaData: { type: 'lib' },
      shared: [
        // valid
        { name: 'react', version: '18.2.0', singleton: true, requiredVersion: '^18.0.0' },
        // malformed shape — non-string name
        { name: 42, version: '1.0.0' },
        // malformed shape — entry is not an object
        null,
        // unrelated junk preserved by extra-fields union
        { name: 'lodash', version: '4.17.21', extraStuff: { nested: true } },
      ],
    };
    const manifest = adaptMf2Manifest(raw);

    expect(Object.keys(manifest.shared.declared).sort()).toEqual(['lodash', 'react']);
    expect(manifest.versions.installed.react).toBe('18.2.0');
    expect(manifest.versions.installed.lodash).toBe('4.17.21');
  });

  it('handles manifest with no shared field at all', () => {
    const manifest = adaptMf2Manifest({ name: 'thin', metaData: { type: 'app' } });
    expect(manifest.shared.declared).toEqual({});
    expect(manifest.versions.installed).toEqual({});
    expect(manifest.usage.resolvedPackages).toEqual([]);
  });

  it('handles manifest with shared that has no version (declared but uninstalled)', () => {
    const manifest = adaptMf2Manifest({
      name: 'lib',
      shared: [{ name: 'react', singleton: true, requiredVersion: '^18.0.0' }],
    });
    expect(manifest.shared.declared.react).toEqual({ singleton: true, requiredVersion: '^18.0.0' });
    expect(manifest.versions.installed.react).toBeUndefined();
  });
});

// ─── Mixing manifest formats ─────────────────────────────────────────────────

describe('stress: mixing native ProjectManifest with adapted MF 2.0', () => {
  it('isMf2Manifest distinguishes the two side-by-side', () => {
    const native: ProjectManifest = {
      schemaVersion: 2,
      generatedAt: '',
      project: { name: 'native', root: '', kind: 'unknown' },
      source: { depth: 'direct', sourceDirs: [], filesScanned: 0 },
      usage: { directPackages: [], resolvedPackages: [], packageDetails: [] },
      shared: { declared: {}, source: 'explicit' },
      versions: { declared: {}, installed: {} },
    };
    const mf2 = makeMf2({ name: 'mf2', type: 'app', shared: [{ name: 'react', version: '18.2.0' }] });

    expect(isMf2Manifest(native)).toBe(false);
    expect(isMf2Manifest(mf2)).toBe(true);
  });

  it('analyzeFederation accepts both formats together', () => {
    const native: ProjectManifest = {
      schemaVersion: 2,
      generatedAt: '',
      project: { name: 'native', root: '', kind: 'unknown' },
      source: { depth: 'direct', sourceDirs: [], filesScanned: 0 },
      usage: {
        directPackages: ['react'],
        resolvedPackages: ['react'],
        packageDetails: [{ package: 'react', importCount: 1, files: ['src/a.ts'], via: 'direct', deepImports: [] }],
      },
      shared: { declared: { react: { singleton: true, requiredVersion: '^18.2.0' } }, source: 'explicit' },
      versions: { declared: { react: '^18.2.0' }, installed: { react: '18.2.0' } },
    };
    const adapted = adaptMf2Manifest(makeMf2({
      name: 'adapted', type: 'lib',
      shared: [{ name: 'react', version: '17.0.2', singleton: true, requiredVersion: '^17.0.2' }],
    }));

    const report = analyzeFederation([native, adapted]);
    expect(report.versionConflicts.find((c) => c.package === 'react')).toBeDefined();
  });
});

// ─── Bulk shared list ────────────────────────────────────────────────────────

describe('stress: large shared list (50 packages) preserved end-to-end', () => {
  it('maps 50 distinct shared entries with versions and configs', () => {
    const shared = Array.from({ length: 50 }, (_, i) => ({
      name: `pkg-${i}`,
      version: `${i + 1}.0.0`,
      singleton: i % 2 === 0,
      requiredVersion: `^${i + 1}.0.0`,
    }));
    const manifest = adaptMf2Manifest(makeMf2({ name: 'big', type: 'app', shared }));

    expect(Object.keys(manifest.shared.declared)).toHaveLength(50);
    expect(Object.keys(manifest.versions.installed)).toHaveLength(50);
    expect(manifest.shared.declared['pkg-0'].singleton).toBe(true);
    expect(manifest.shared.declared['pkg-1'].singleton).toBe(false);
    expect(manifest.versions.installed['pkg-49']).toBe('50.0.0');
  });
});

// ─── kind inference edge cases ────────────────────────────────────────────────

describe('stress: kind inference fallbacks', () => {
  it('explicit type wins over heuristic counts', () => {
    const m = adaptMf2Manifest(makeMf2({ name: 'x', type: 'lib', remotes: 5, exposes: 0 }));
    // remotes count would suggest host, but explicit type=lib must win.
    expect(m.project.kind).toBe('remote');
  });

  it('both remotes and exposes present → unknown (ambiguous)', () => {
    const m = adaptMf2Manifest(makeMf2({ name: 'x', remotes: 1, exposes: 1 }));
    expect(m.project.kind).toBe('unknown');
  });

  it('neither remotes nor exposes nor type → unknown', () => {
    const m = adaptMf2Manifest({ name: 'x', shared: [] });
    expect(m.project.kind).toBe('unknown');
  });
});
