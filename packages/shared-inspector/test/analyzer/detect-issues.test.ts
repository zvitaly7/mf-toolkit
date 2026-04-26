import { describe, it, expect } from 'vitest';
import { detectIssues } from '../../src/analyzer/detect-issues.js';
import { mergePolicy } from '../../src/analyzer/policy.js';

const defaultPolicy = mergePolicy();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<Parameters<typeof detectIssues>[0]> = {}) {
  return {
    resolvedPackages: [],
    packageDetails: [],
    sharedDeclared: {},
    installedVersions: {},
    policy: defaultPolicy,
    ...overrides,
  };
}

// ─── Unused ───────────────────────────────────────────────────────────────────

describe('detectIssues — unused', () => {
  it('flags package in shared config not observed in resolvedPackages', () => {
    const result = detectIssues(makeInput({
      resolvedPackages: ['react'],
      sharedDeclared: {
        react: { singleton: true },
        lodash: {},
      },
    }));

    expect(result.unused).toEqual([{ package: 'lodash', singleton: false }]);
  });

  it('does not flag packages in alwaysShared even when not observed', () => {
    const result = detectIssues(makeInput({
      resolvedPackages: [],
      sharedDeclared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
      },
    }));

    expect(result.unused).toHaveLength(0);
  });

  it('respects custom alwaysShared from user policy', () => {
    const policy = mergePolicy({ alwaysShared: ['lodash'] });
    const result = detectIssues(makeInput({
      resolvedPackages: [],
      sharedDeclared: { lodash: {}, mobx: {} },
      policy,
    }));

    const names = result.unused.map(u => u.package);
    expect(names).not.toContain('lodash');
    expect(names).toContain('mobx');
  });

  it('preserves singleton flag on unused entry', () => {
    const result = detectIssues(makeInput({
      resolvedPackages: [],
      sharedDeclared: { 'some-lib': { singleton: true } },
    }));

    expect(result.unused).toEqual([{ package: 'some-lib', singleton: true }]);
  });

  it('returns empty unused when shared config is empty', () => {
    const result = detectIssues(makeInput({ sharedDeclared: {} }));
    expect(result.unused).toHaveLength(0);
  });

  it('returns empty unused when all shared packages are observed', () => {
    const result = detectIssues(makeInput({
      resolvedPackages: ['mobx', 'axios'],
      sharedDeclared: { mobx: {}, axios: {} },
    }));

    expect(result.unused).toHaveLength(0);
  });
});

// ─── Candidates ───────────────────────────────────────────────────────────────

describe('detectIssues — candidates', () => {
  it('suggests observed package that is in share-candidates list but not in shared config', () => {
    const result = detectIssues(makeInput({
      resolvedPackages: ['mobx'],
      packageDetails: [{ package: 'mobx', importCount: 5, files: ['src/store.ts'], via: 'direct', deepImports: [] }],
      sharedDeclared: {},
    }));

    expect(result.candidates).toContainEqual(
      expect.objectContaining({ package: 'mobx', importCount: 5, via: 'direct' }),
    );
  });

  it('does not suggest package already in shared config', () => {
    const result = detectIssues(makeInput({
      resolvedPackages: ['mobx'],
      sharedDeclared: { mobx: { singleton: true } },
    }));

    expect(result.candidates).toHaveLength(0);
  });

  it('does not suggest package not in the built-in candidates list', () => {
    const result = detectIssues(makeInput({
      resolvedPackages: ['some-obscure-lib'],
      sharedDeclared: {},
    }));

    expect(result.candidates).toHaveLength(0);
  });

  it('includes via: reexport when package was found through barrel re-export', () => {
    const result = detectIssues(makeInput({
      resolvedPackages: ['mobx'],
      packageDetails: [
        { package: 'mobx', importCount: 3, files: ['src/shared/index.ts'], via: 'reexport', deepImports: [] },
      ],
      sharedDeclared: {},
    }));

    expect(result.candidates[0].via).toBe('reexport');
  });

  it('returns empty candidates when resolvedPackages is empty', () => {
    const result = detectIssues(makeInput({ resolvedPackages: [] }));
    expect(result.candidates).toHaveLength(0);
  });
});

// ─── Mismatched ───────────────────────────────────────────────────────────────

describe('detectIssues — mismatched', () => {
  it('detects mismatch when installed version does not satisfy requiredVersion', () => {
    const result = detectIssues(makeInput({
      sharedDeclared: { react: { requiredVersion: '^19.0.0' } },
      installedVersions: { react: '18.3.1' },
    }));

    expect(result.mismatched).toEqual([
      { package: 'react', configured: '^19.0.0', installed: '18.3.1' },
    ]);
  });

  it('does not flag mismatch when installed version satisfies requiredVersion', () => {
    const result = detectIssues(makeInput({
      sharedDeclared: { react: { requiredVersion: '^19.0.0' } },
      installedVersions: { react: '19.1.0' },
    }));

    expect(result.mismatched).toHaveLength(0);
  });

  it('skips mismatch check when requiredVersion is not set', () => {
    const result = detectIssues(makeInput({
      sharedDeclared: { mobx: {} },
      installedVersions: { mobx: '6.12.0' },
    }));

    expect(result.mismatched).toHaveLength(0);
  });

  it('skips mismatch check when installed version is unknown (empty installedVersions)', () => {
    const result = detectIssues(makeInput({
      sharedDeclared: { react: { requiredVersion: '^19.0.0' } },
      installedVersions: {},
    }));

    expect(result.mismatched).toHaveLength(0);
  });

  it('handles exact version pinning mismatch', () => {
    const result = detectIssues(makeInput({
      sharedDeclared: { react: { requiredVersion: '19.0.0' } },
      installedVersions: { react: '19.0.1' },
    }));

    expect(result.mismatched).toHaveLength(1);
  });
});

// ─── Singleton risks ──────────────────────────────────────────────────────────

describe('detectIssues — singletonRisks', () => {
  it('flags state-manager package shared without singleton: true', () => {
    const result = detectIssues(makeInput({
      sharedDeclared: { mobx: {} },
    }));

    expect(result.singletonRisks).toContainEqual({ package: 'mobx' });
  });

  it('does not flag package when singleton: true is set', () => {
    const result = detectIssues(makeInput({
      sharedDeclared: { mobx: { singleton: true } },
    }));

    const names = result.singletonRisks.map(r => r.package);
    expect(names).not.toContain('mobx');
  });

  it('does not flag package not in singleton-risk list', () => {
    const result = detectIssues(makeInput({
      sharedDeclared: { axios: {} },
    }));

    expect(result.singletonRisks).toHaveLength(0);
  });

  it('respects additionalSingletonRisks from user policy', () => {
    const policy = mergePolicy({ additionalSingletonRisks: ['my-state-lib'] });
    const result = detectIssues(makeInput({
      sharedDeclared: { 'my-state-lib': {} },
      policy,
    }));

    expect(result.singletonRisks).toContainEqual({ package: 'my-state-lib' });
  });
});

// ─── Deep-import bypass ──────────────────────────────────────────────────────

describe('detectIssues — deepImportBypass', () => {
  it('flags a shared package whose source uses subpath specifiers', () => {
    const result = detectIssues(makeInput({
      resolvedPackages: ['lodash'],
      packageDetails: [{
        package: 'lodash',
        importCount: 2,
        files: ['src/a.ts', 'src/b.ts'],
        via: 'direct',
        deepImports: ['lodash/cloneDeep', 'lodash/debounce'],
      }],
      sharedDeclared: { lodash: { singleton: true } },
    }));

    expect(result.deepImportBypass).toHaveLength(1);
    const entry = result.deepImportBypass[0];
    expect(entry.package).toBe('lodash');
    expect(entry.specifiers).toEqual(['lodash/cloneDeep', 'lodash/debounce']);
    expect(entry.fileCount).toBe(2);
    expect(entry.files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('does not flag when shared package only uses root specifier', () => {
    const result = detectIssues(makeInput({
      resolvedPackages: ['lodash'],
      packageDetails: [{
        package: 'lodash',
        importCount: 1,
        files: ['src/a.ts'],
        via: 'direct',
        deepImports: [],
      }],
      sharedDeclared: { lodash: { singleton: true } },
    }));

    expect(result.deepImportBypass).toHaveLength(0);
  });

  it('does not flag deep imports of packages that are not in shared config', () => {
    const result = detectIssues(makeInput({
      resolvedPackages: ['lodash'],
      packageDetails: [{
        package: 'lodash',
        importCount: 1,
        files: ['src/a.ts'],
        via: 'direct',
        deepImports: ['lodash/cloneDeep'],
      }],
      sharedDeclared: {},
    }));

    expect(result.deepImportBypass).toHaveLength(0);
  });

  it('excludes default-allowlisted react/jsx-runtime', () => {
    const result = detectIssues(makeInput({
      resolvedPackages: ['react'],
      packageDetails: [{
        package: 'react',
        importCount: 1,
        files: ['src/app.tsx'],
        via: 'direct',
        deepImports: ['react/jsx-runtime'],
      }],
      sharedDeclared: { react: { singleton: true } },
    }));

    expect(result.deepImportBypass).toHaveLength(0);
  });

  it('respects user-provided deepImportAllowlist additions', () => {
    const policy = mergePolicy({ deepImportAllowlist: ['lodash/fp'] });
    const result = detectIssues(makeInput({
      resolvedPackages: ['lodash'],
      packageDetails: [{
        package: 'lodash',
        importCount: 1,
        files: ['src/a.ts'],
        via: 'direct',
        deepImports: ['lodash/fp', 'lodash/cloneDeep'],
      }],
      sharedDeclared: { lodash: {} },
      policy,
    }));

    expect(result.deepImportBypass).toHaveLength(1);
    expect(result.deepImportBypass[0].specifiers).toEqual(['lodash/cloneDeep']);
  });
});
