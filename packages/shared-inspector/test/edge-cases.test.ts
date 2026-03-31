import { describe, it, expect } from 'vitest';
import { extractSharedFromCompiler } from '../src/collector/extract-mfp-shared.js';
import { analyzeFederation } from '../src/analyzer/analyze-federation.js';
import { formatFederationReport } from '../src/reporter/format-federation-report.js';
import type { ProjectManifest } from '../src/types.js';

function makeManifest(name: string, shared: Record<string, any>, used: string[]): ProjectManifest {
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    project: { name, root: '.', kind: 'unknown' },
    source: { depth: 'local-graph', sourceDirs: ['./src'], filesScanned: 5 },
    usage: { directPackages: used, resolvedPackages: used, packageDetails: [] },
    shared: { declared: shared, source: 'explicit' },
    versions: { declared: {}, installed: {} },
  };
}

// ── extractSharedFromCompiler ─────────────────────────────────────────────────

describe('extractSharedFromCompiler — edge cases', () => {
  class ModuleFederationPlugin {
    _options: any;
    constructor(o: any) { this._options = o; }
  }

  it('handles null/undefined entries in plugins array', () => {
    const compiler = {
      options: { plugins: [null, undefined, new ModuleFederationPlugin({ shared: { react: {} } })] },
    };
    expect(extractSharedFromCompiler(compiler)).toEqual({ react: {} });
  });

  it('returns null when shared is a function (dynamic shared config)', () => {
    const compiler = {
      options: { plugins: [new ModuleFederationPlugin({ shared: () => ({ react: {} }) })] },
    };
    expect(extractSharedFromCompiler(compiler)).toBeNull();
  });

  it('returns null when _options.shared is null', () => {
    const compiler = {
      options: { plugins: [new ModuleFederationPlugin({ shared: null })] },
    };
    expect(extractSharedFromCompiler(compiler)).toBeNull();
  });

  it('handles plugin stored without _options prefix (community variants)', () => {
    const plugin = { constructor: { name: 'ModuleFederationPlugin' }, options: { shared: { vue: {} } } };
    expect(extractSharedFromCompiler({ options: { plugins: [plugin] } })).toEqual({ vue: {} });
  });
});

// ── version conflict — tricky semver ranges ───────────────────────────────────

describe('analyzeFederation — version conflict edge cases', () => {
  it('does NOT flag >=17 vs ^18 (they overlap at 18.x)', () => {
    const host = makeManifest('host', { react: { requiredVersion: '>=17.0.0' } }, ['react']);
    const remote = makeManifest('remote', { react: { requiredVersion: '^18.0.0' } }, ['react']);
    expect(analyzeFederation([host, remote]).versionConflicts).toHaveLength(0);
  });

  it('flags ~4.17.0 vs ~4.16.0 (non-overlapping patch ranges)', () => {
    // ~4.17.0 = >=4.17.0 <4.18.0 vs ~4.16.0 = >=4.16.0 <4.17.0 — gap at 4.17.0 boundary
    const host = makeManifest('host', { lodash: { requiredVersion: '~4.17.0' } }, ['lodash']);
    const remote = makeManifest('remote', { lodash: { requiredVersion: '~4.16.0' } }, ['lodash']);
    expect(analyzeFederation([host, remote]).versionConflicts.map(v => v.package)).toContain('lodash');
  });

  it('does NOT throw on workspace:* ranges — silently skips', () => {
    const host = makeManifest('host', { 'my-pkg': { requiredVersion: 'workspace:*' } }, ['my-pkg']);
    const remote = makeManifest('remote', { 'my-pkg': { requiredVersion: '^1.0.0' } }, ['my-pkg']);
    expect(() => analyzeFederation([host, remote])).not.toThrow();
  });

  it('does NOT throw on "latest" as requiredVersion', () => {
    const host = makeManifest('host', { react: { requiredVersion: 'latest' } }, ['react']);
    const remote = makeManifest('remote', { react: { requiredVersion: '^18.0.0' } }, ['react']);
    expect(() => analyzeFederation([host, remote])).not.toThrow();
  });

  it('flags ^1.0.0 vs exact 2.0.0 (no overlap — ^1 stops before 2)', () => {
    const host = makeManifest('host', { mobx: { requiredVersion: '^1.0.0' } }, ['mobx']);
    const remote = makeManifest('remote', { mobx: { requiredVersion: '2.0.0' } }, ['mobx']);
    expect(analyzeFederation([host, remote]).versionConflicts.map(v => v.package)).toContain('mobx');
  });

  it('does NOT flag ^1.5.0 vs ^1.0.0 (overlap at >=1.5.0)', () => {
    const host = makeManifest('host', { mobx: { requiredVersion: '^1.5.0' } }, ['mobx']);
    const remote = makeManifest('remote', { mobx: { requiredVersion: '^1.0.0' } }, ['mobx']);
    expect(analyzeFederation([host, remote]).versionConflicts).toHaveLength(0);
  });

  it('does NOT flag ^1.0.0 || ^2.0.0 vs ^2.0.0 (union range, overlap at 2.x)', () => {
    const host = makeManifest('host', { mobx: { requiredVersion: '^1.0.0 || ^2.0.0' } }, ['mobx']);
    const remote = makeManifest('remote', { mobx: { requiredVersion: '^2.0.0' } }, ['mobx']);
    expect(analyzeFederation([host, remote]).versionConflicts).toHaveLength(0);
  });
});

// ── duplicate manifest names ──────────────────────────────────────────────────

describe('analyzeFederation — duplicate manifest names', () => {
  it('does not crash', () => {
    const a = makeManifest('host', { react: { singleton: true } }, ['react']);
    const b = makeManifest('host', { react: { singleton: false } }, ['react']);
    expect(() => analyzeFederation([a, b])).not.toThrow();
  });
});

// ── singleton mismatch 3-way split ────────────────────────────────────────────

describe('analyzeFederation — 3-way singleton split', () => {
  it('singletonIn=[host], nonSingletonIn=[remote1, remote2] for true/false/unspecified', () => {
    const host = makeManifest('host', { mobx: { singleton: true } }, ['mobx']);
    const r1   = makeManifest('remote1', { mobx: { singleton: false } }, ['mobx']);
    const r2   = makeManifest('remote2', { mobx: {} }, ['mobx']); // unspecified
    const report = analyzeFederation([host, r1, r2]);

    const entry = report.singletonMismatches.find(s => s.package === 'mobx');
    expect(entry).toBeDefined();
    expect(entry!.singletonIn).toEqual(['host']);
    expect(entry!.nonSingletonIn).toContain('remote1');
    expect(entry!.nonSingletonIn).toContain('remote2');
    expect(entry!.nonSingletonIn).toHaveLength(2);
  });
});

// ── ghost share — packages used by solo MF only ───────────────────────────────

describe('analyzeFederation — ghost share edge cases', () => {
  it('ghost share usedUnsharedBy is empty when others do NOT use the package', () => {
    const host = makeManifest('host', { 'date-fns': {} }, ['react', 'date-fns']);
    const remote = makeManifest('remote', {}, ['react']); // doesn't use date-fns
    const report = analyzeFederation([host, remote]);

    const entry = report.ghostShares.find(g => g.package === 'date-fns');
    expect(entry).toBeDefined();
    expect(entry!.usedUnsharedBy).toHaveLength(0);
  });

  it('ghost share usedUnsharedBy lists MFs that use but dont share', () => {
    const host   = makeManifest('host',   { 'date-fns': {} }, ['date-fns']);
    const remote = makeManifest('remote', {},                 ['date-fns']); // uses but not shared
    const report = analyzeFederation([host, remote]);

    const entry = report.ghostShares.find(g => g.package === 'date-fns');
    expect(entry).toBeDefined();
    expect(entry!.usedUnsharedBy).toContain('remote');
  });

  it('no ghost when 2 MFs both share the same package', () => {
    const host   = makeManifest('host',   { lodash: {} }, ['lodash']);
    const remote = makeManifest('remote', { lodash: {} }, ['lodash']);
    expect(analyzeFederation([host, remote]).ghostShares).toHaveLength(0);
  });
});

// ── version conflict — 0.x.x semver (^ behaves differently) ──────────────────

describe('analyzeFederation — 0.x.x semver edge cases', () => {
  it('flags ^0.5.0 vs ^0.6.0 (no overlap — caret locks minor for 0.x)', () => {
    const host   = makeManifest('host',   { pkg: { requiredVersion: '^0.5.0' } }, ['pkg']);
    const remote = makeManifest('remote', { pkg: { requiredVersion: '^0.6.0' } }, ['pkg']);
    expect(analyzeFederation([host, remote]).versionConflicts.map(v => v.package)).toContain('pkg');
  });

  it('does NOT flag ^0.5.0 vs ^0.5.1 (both fit >=0.5.1 <0.6.0)', () => {
    const host   = makeManifest('host',   { pkg: { requiredVersion: '^0.5.0' } }, ['pkg']);
    const remote = makeManifest('remote', { pkg: { requiredVersion: '^0.5.1' } }, ['pkg']);
    expect(analyzeFederation([host, remote]).versionConflicts).toHaveLength(0);
  });
});

// ── extractSharedFromCompiler — plugin order independence ─────────────────────

describe('extractSharedFromCompiler — plugin order independence', () => {
  class ModuleFederationPlugin {
    _options: any;
    constructor(o: any) { this._options = o; }
  }
  class OtherPlugin {}

  it('finds MFP when it comes AFTER other plugins', () => {
    const compiler = {
      options: { plugins: [new OtherPlugin(), new OtherPlugin(), new ModuleFederationPlugin({ shared: { react: {} } })] },
    };
    expect(extractSharedFromCompiler(compiler)).toEqual({ react: {} });
  });

  it('finds MFP when it comes BEFORE other plugins', () => {
    const compiler = {
      options: { plugins: [new ModuleFederationPlugin({ shared: { react: {} } }), new OtherPlugin()] },
    };
    expect(extractSharedFromCompiler(compiler)).toEqual({ react: {} });
  });
});

// ── formatFederationReport — formatting edge cases ────────────────────────────

describe('formatFederationReport — edge cases', () => {
  it('does not crash with empty MF names', () => {
    const report = {
      ghostShares: [{ package: 'lodash', sharedBy: '', usedUnsharedBy: [''] }],
      hostGaps: [], versionConflicts: [], singletonMismatches: [],
      summary: { totalManifests: 2, ghostSharesCount: 1, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    };
    expect(() => formatFederationReport(report)).not.toThrow();
  });

  it('renders all 4 MF names in version conflict when 4 MFs involved', () => {
    const report = {
      ghostShares: [], hostGaps: [], singletonMismatches: [],
      versionConflicts: [{
        package: 'react',
        versions: { host: '^17.0.0', r1: '^18.0.0', r2: '^18.0.0', r3: '^17.0.0' },
      }],
      summary: { totalManifests: 4, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 1, singletonMismatchesCount: 0 },
    };
    const output = formatFederationReport(report);
    expect(output).toContain('host: ^17.0.0');
    expect(output).toContain('r1: ^18.0.0');
    expect(output).toContain('r3: ^17.0.0');
  });
});
