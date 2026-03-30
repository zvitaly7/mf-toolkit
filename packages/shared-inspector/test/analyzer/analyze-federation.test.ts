import { describe, it, expect } from 'vitest';
import { analyzeFederation } from '../../src/analyzer/analyze-federation.js';
import type { ProjectManifest } from '../../src/types.js';

// ─── Fixture factory ──────────────────────────────────────────────────────────

function makeManifest(
  name: string,
  shared: Record<string, { singleton?: boolean; eager?: boolean; requiredVersion?: string }>,
  used: string[],
  kind: 'host' | 'remote' | 'unknown' = 'unknown',
): ProjectManifest {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: { name, root: '.', kind },
    source: { depth: 'local-graph', sourceDirs: ['./src'], filesScanned: 10 },
    usage: {
      directPackages: used,
      resolvedPackages: used,
      packageDetails: used.map((pkg) => ({ package: pkg, importCount: 1, files: [`src/${pkg}.ts`], via: 'direct' })),
    },
    shared: { declared: shared, source: 'explicit' },
    versions: { declared: {}, installed: {} },
  };
}

// ─── Ghost shares ─────────────────────────────────────────────────────────────

describe('analyzeFederation — ghost shares', () => {
  it('detects package shared by only one MF that no other MF uses', () => {
    const host = makeManifest('host', { lodash: {} }, ['react']);
    const remote = makeManifest('remote', { react: {} }, ['react']);
    const report = analyzeFederation([host, remote]);

    expect(report.ghostShares).toContainEqual(
      expect.objectContaining({ package: 'lodash', sharedBy: 'host' }),
    );
  });

  it('does NOT flag package shared by multiple MFs', () => {
    const host = makeManifest('host', { react: {}, lodash: {} }, ['react', 'lodash']);
    const remote = makeManifest('remote', { react: {}, lodash: {} }, ['react', 'lodash']);
    const report = analyzeFederation([host, remote]);

    expect(report.ghostShares.map((g) => g.package)).not.toContain('lodash');
  });

  it('does NOT flag react/react-dom even when only one MF shares them', () => {
    const host = makeManifest('host', { react: { singleton: true } }, ['react']);
    const remote = makeManifest('remote', {}, ['react']);
    const report = analyzeFederation([host, remote]);

    expect(report.ghostShares.map((g) => g.package)).not.toContain('react');
  });

  it('ghost share entry includes usedUnsharedBy when others use but do not share', () => {
    const host = makeManifest('host', { mobx: {} }, ['react', 'mobx']);
    const remote = makeManifest('remote', {}, ['react', 'mobx']); // uses mobx but doesn't share
    const report = analyzeFederation([host, remote]);

    const entry = report.ghostShares.find((g) => g.package === 'mobx');
    expect(entry).toBeDefined();
    expect(entry?.usedUnsharedBy).toContain('remote');
  });

  it('summary.ghostSharesCount matches array length', () => {
    const host = makeManifest('host', { lodash: {}, moment: {} }, ['react']);
    const remote = makeManifest('remote', { react: {} }, ['react']);
    const report = analyzeFederation([host, remote]);

    expect(report.summary.ghostSharesCount).toBe(report.ghostShares.length);
  });

  it('single manifest produces no ghost shares', () => {
    const host = makeManifest('host', { react: {}, lodash: {} }, ['react', 'lodash']);
    const report = analyzeFederation([host]);

    expect(report.ghostShares).toHaveLength(0);
  });
});

// ─── Host gaps ────────────────────────────────────────────────────────────────

describe('analyzeFederation — host gaps', () => {
  it('detects package used by 2+ MFs but not in shared by anyone', () => {
    const host = makeManifest('host', { react: {} }, ['react', 'axios']);
    const remote = makeManifest('remote', { react: {} }, ['react', 'axios']);
    const report = analyzeFederation([host, remote]);

    const entry = report.hostGaps.find((g) => g.package === 'axios');
    expect(entry).toBeDefined();
    expect(entry?.missingIn).toContain('host');
    expect(entry?.missingIn).toContain('remote');
  });

  it('does NOT flag package used by only one MF', () => {
    const host = makeManifest('host', { react: {} }, ['react', 'lodash']);
    const remote = makeManifest('remote', { react: {} }, ['react']);
    const report = analyzeFederation([host, remote]);

    expect(report.hostGaps.map((g) => g.package)).not.toContain('lodash');
  });

  it('does NOT flag package that is already in shared', () => {
    const host = makeManifest('host', { react: {}, mobx: {} }, ['react', 'mobx']);
    const remote = makeManifest('remote', { react: {} }, ['react', 'mobx']);
    const report = analyzeFederation([host, remote]);

    expect(report.hostGaps.map((g) => g.package)).not.toContain('mobx');
  });

  it('does NOT flag always-shared packages (react, react-dom)', () => {
    const host = makeManifest('host', {}, ['react']);
    const remote = makeManifest('remote', {}, ['react']);
    const report = analyzeFederation([host, remote]);

    expect(report.hostGaps.map((g) => g.package)).not.toContain('react');
  });

  it('summary.hostGapsCount matches array length', () => {
    const host = makeManifest('host', {}, ['react', 'axios', 'lodash']);
    const remote = makeManifest('remote', {}, ['react', 'axios', 'lodash']);
    const report = analyzeFederation([host, remote]);

    expect(report.summary.hostGapsCount).toBe(report.hostGaps.length);
  });

  it('detects gap across 3 MFs', () => {
    const host = makeManifest('host', { react: {} }, ['react', 'mobx']);
    const r1 = makeManifest('remote1', { react: {} }, ['react', 'mobx']);
    const r2 = makeManifest('remote2', { react: {} }, ['react', 'mobx']);
    const report = analyzeFederation([host, r1, r2]);

    const entry = report.hostGaps.find((g) => g.package === 'mobx');
    expect(entry).toBeDefined();
    expect(entry?.missingIn).toHaveLength(3);
  });
});

// ─── Version conflicts ────────────────────────────────────────────────────────

describe('analyzeFederation — version conflicts', () => {
  it('detects incompatible requiredVersion ranges across MFs', () => {
    const host = makeManifest('host', { react: { requiredVersion: '^17.0.0' } }, ['react']);
    const remote = makeManifest('remote', { react: { requiredVersion: '^18.0.0' } }, ['react']);
    const report = analyzeFederation([host, remote]);

    const entry = report.versionConflicts.find((v) => v.package === 'react');
    expect(entry).toBeDefined();
    expect(entry?.versions['host']).toBe('^17.0.0');
    expect(entry?.versions['remote']).toBe('^18.0.0');
  });

  it('does NOT flag compatible ranges (^18.0.0 and ^18.2.0)', () => {
    const host = makeManifest('host', { react: { requiredVersion: '^18.0.0' } }, ['react']);
    const remote = makeManifest('remote', { react: { requiredVersion: '^18.2.0' } }, ['react']);
    const report = analyzeFederation([host, remote]);

    expect(report.versionConflicts.map((v) => v.package)).not.toContain('react');
  });

  it('does NOT flag when only one MF declares requiredVersion', () => {
    const host = makeManifest('host', { react: { requiredVersion: '^18.0.0' } }, ['react']);
    const remote = makeManifest('remote', { react: {} }, ['react']);
    const report = analyzeFederation([host, remote]);

    expect(report.versionConflicts.map((v) => v.package)).not.toContain('react');
  });

  it('detects conflict across 3 MFs', () => {
    const host = makeManifest('host', { mobx: { requiredVersion: '^5.0.0' } }, ['mobx']);
    const r1 = makeManifest('remote1', { mobx: { requiredVersion: '^6.0.0' } }, ['mobx']);
    const r2 = makeManifest('remote2', { mobx: { requiredVersion: '^6.0.0' } }, ['mobx']);
    const report = analyzeFederation([host, r1, r2]);

    const entry = report.versionConflicts.find((v) => v.package === 'mobx');
    expect(entry).toBeDefined();
    expect(Object.keys(entry!.versions)).toHaveLength(3);
  });

  it('summary.versionConflictsCount matches array length', () => {
    const host = makeManifest('host', {
      react: { requiredVersion: '^17.0.0' },
      mobx: { requiredVersion: '^5.0.0' },
    }, ['react', 'mobx']);
    const remote = makeManifest('remote', {
      react: { requiredVersion: '^18.0.0' },
      mobx: { requiredVersion: '^6.0.0' },
    }, ['react', 'mobx']);
    const report = analyzeFederation([host, remote]);

    expect(report.summary.versionConflictsCount).toBe(report.versionConflicts.length);
  });
});

// ─── Singleton mismatches ─────────────────────────────────────────────────────

describe('analyzeFederation — singleton mismatches', () => {
  it('detects package with singleton: true in one MF and false in another', () => {
    const host = makeManifest('host', { react: { singleton: true } }, ['react']);
    const remote = makeManifest('remote', { react: { singleton: false } }, ['react']);
    const report = analyzeFederation([host, remote]);

    const entry = report.singletonMismatches.find((s) => s.package === 'react');
    expect(entry).toBeDefined();
    expect(entry?.singletonIn).toContain('host');
    expect(entry?.nonSingletonIn).toContain('remote');
  });

  it('detects package with singleton: true in one MF and unspecified in another', () => {
    const host = makeManifest('host', { mobx: { singleton: true } }, ['mobx']);
    const remote = makeManifest('remote', { mobx: {} }, ['mobx']); // no singleton specified
    const report = analyzeFederation([host, remote]);

    const entry = report.singletonMismatches.find((s) => s.package === 'mobx');
    expect(entry).toBeDefined();
    expect(entry?.singletonIn).toContain('host');
    expect(entry?.nonSingletonIn).toContain('remote');
  });

  it('does NOT flag package with singleton: true in all MFs', () => {
    const host = makeManifest('host', { react: { singleton: true } }, ['react']);
    const remote = makeManifest('remote', { react: { singleton: true } }, ['react']);
    const report = analyzeFederation([host, remote]);

    expect(report.singletonMismatches.map((s) => s.package)).not.toContain('react');
  });

  it('does NOT flag package with singleton unspecified everywhere', () => {
    const host = makeManifest('host', { mobx: {} }, ['mobx']);
    const remote = makeManifest('remote', { mobx: {} }, ['mobx']);
    const report = analyzeFederation([host, remote]);

    expect(report.singletonMismatches.map((s) => s.package)).not.toContain('mobx');
  });

  it('summary.singletonMismatchesCount matches array length', () => {
    const host = makeManifest('host', {
      react: { singleton: true },
      mobx: { singleton: true },
    }, ['react', 'mobx']);
    const remote = makeManifest('remote', {
      react: { singleton: false },
      mobx: { singleton: false },
    }, ['react', 'mobx']);
    const report = analyzeFederation([host, remote]);

    expect(report.summary.singletonMismatchesCount).toBe(report.singletonMismatches.length);
  });
});

// ─── Summary ──────────────────────────────────────────────────────────────────

describe('analyzeFederation — summary', () => {
  it('totalManifests reflects input array length', () => {
    const manifests = [
      makeManifest('host', {}, ['react']),
      makeManifest('remote1', {}, ['react']),
      makeManifest('remote2', {}, ['react']),
    ];
    const report = analyzeFederation(manifests);

    expect(report.summary.totalManifests).toBe(3);
  });

  it('clean federation produces all-zero summary', () => {
    const host = makeManifest('host', { react: { singleton: true, requiredVersion: '^18.0.0' } }, ['react']);
    const remote = makeManifest('remote', { react: { singleton: true, requiredVersion: '^18.0.0' } }, ['react']);
    const report = analyzeFederation([host, remote]);

    expect(report.ghostShares).toHaveLength(0);
    expect(report.hostGaps).toHaveLength(0);
    expect(report.versionConflicts).toHaveLength(0);
    expect(report.singletonMismatches).toHaveLength(0);
    expect(report.summary.ghostSharesCount).toBe(0);
    expect(report.summary.hostGapsCount).toBe(0);
    expect(report.summary.versionConflictsCount).toBe(0);
    expect(report.summary.singletonMismatchesCount).toBe(0);
  });

  it('empty manifests array returns zero report', () => {
    const report = analyzeFederation([]);

    expect(report.summary.totalManifests).toBe(0);
    expect(report.ghostShares).toHaveLength(0);
    expect(report.hostGaps).toHaveLength(0);
  });
});

// ─── Integration: real-world federation scenario ──────────────────────────────

describe('analyzeFederation — integration', () => {
  it('catches all 4 issue types in one call', () => {
    // host: shares lodash alone (ghost), uses axios without sharing, react@17
    const host = makeManifest('host', {
      react: { singleton: true, requiredVersion: '^17.0.0' },
      lodash: {},                               // ghost: remote doesn't share or use it
    }, ['react', 'axios', 'lodash']);

    // remote: react@18 (version conflict), no singleton on react (singleton mismatch),
    //         also uses axios without sharing (host gap)
    const remote = makeManifest('remote', {
      react: { singleton: false, requiredVersion: '^18.0.0' },
    }, ['react', 'axios']);

    const report = analyzeFederation([host, remote]);

    expect(report.ghostShares.map((g) => g.package)).toContain('lodash');
    expect(report.hostGaps.map((g) => g.package)).toContain('axios');
    expect(report.versionConflicts.map((v) => v.package)).toContain('react');
    expect(report.singletonMismatches.map((s) => s.package)).toContain('react');
  });

  it('custom alwaysShared removes packages from ghost/gap detection', () => {
    const host = makeManifest('host', { 'my-design-system': {} }, ['react']);
    const remote = makeManifest('remote', {}, ['react']);
    const report = analyzeFederation([host, remote], {
      alwaysShared: ['react', 'react-dom', 'my-design-system'],
    });

    expect(report.ghostShares.map((g) => g.package)).not.toContain('my-design-system');
  });
});
