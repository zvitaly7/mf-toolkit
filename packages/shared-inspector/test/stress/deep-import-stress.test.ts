/**
 * Stress / real-world tests for the deep-import bypass detector.
 *
 * Covers patterns that occur in production MF projects:
 *   - Mixed root + deep imports of the same package
 *   - CommonJS require with a deep specifier
 *   - Dynamic import('pkg/sub') with a literal string
 *   - Scoped packages (@scope/pkg/sub)
 *   - Same deep specifier across multiple files (dedup)
 *   - Deep imports propagated through local barrel re-exports (local-graph)
 *   - Default-allowlisted react/jsx-runtime not flagged
 *   - User-supplied deepImportAllowlist subtractions
 *   - Stress: many distinct deep paths within one package
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildProjectManifest } from '../../src/collector/build-project-manifest.js';
import { analyzeProject } from '../../src/analyzer/analyze-project.js';
import { detectIssues } from '../../src/analyzer/detect-issues.js';
import { mergePolicy } from '../../src/analyzer/policy.js';

const FIXTURE_SRC = join(import.meta.dirname, '../fixtures/mf-deep-imports/src');
const FIXTURE_PKG = join(import.meta.dirname, '../fixtures/mf-deep-imports/package.json');

const SHARED_ALL = {
  react: { singleton: true, requiredVersion: '^18.0.0' },
  lodash: {},
  rxjs: {},
  'date-fns': {},
  '@mui/material': {},
};

// ─── End-to-end through the full pipeline ─────────────────────────────────────

describe('stress: deep-import end-to-end (direct mode)', () => {
  it('produces deepImportBypass entries for every offending shared package', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-deep-imports',
      sourceDirs: [FIXTURE_SRC],
      sharedConfig: SHARED_ALL,
      depth: 'direct',
      packageJsonPath: FIXTURE_PKG,
    });
    const report = analyzeProject(manifest);

    const flagged = report.deepImportBypass.map((d) => d.package).sort();
    expect(flagged).toEqual(['@mui/material', 'date-fns', 'lodash', 'rxjs']);

    // react has only react/jsx-runtime which is in the default allowlist —
    // must not be flagged.
    expect(flagged).not.toContain('react');

    expect(report.summary.deepImportBypassCount).toBe(4);
  });

  it('lodash deep specifiers are deduplicated and sorted across two files', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-deep-imports',
      sourceDirs: [FIXTURE_SRC],
      sharedConfig: SHARED_ALL,
      depth: 'direct',
      packageJsonPath: FIXTURE_PKG,
    });
    const report = analyzeProject(manifest);

    const lodash = report.deepImportBypass.find((d) => d.package === 'lodash');
    expect(lodash).toBeDefined();
    // lodash/get appears in both index.ts and utils.ts — must collapse to one.
    expect(lodash!.specifiers).toEqual(
      ['lodash/cloneDeep', 'lodash/debounce', 'lodash/get', 'lodash/set'],
    );
    // Two distinct files contain at least one lodash import.
    expect(lodash!.fileCount).toBeGreaterThanOrEqual(2);
  });

  it('CommonJS require("lodash/debounce") is captured as a deep specifier', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-deep-imports',
      sourceDirs: [FIXTURE_SRC],
      sharedConfig: SHARED_ALL,
      depth: 'direct',
      packageJsonPath: FIXTURE_PKG,
    });
    const lodashDetail = manifest.usage.packageDetails.find((d) => d.package === 'lodash');
    expect(lodashDetail!.deepImports).toContain('lodash/debounce');
  });

  it('dynamic import("rxjs/operators") with a literal is captured', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-deep-imports',
      sourceDirs: [FIXTURE_SRC],
      sharedConfig: SHARED_ALL,
      depth: 'direct',
      packageJsonPath: FIXTURE_PKG,
    });
    const rxjsDetail = manifest.usage.packageDetails.find((d) => d.package === 'rxjs');
    expect(rxjsDetail!.deepImports).toEqual(['rxjs/operators']);
  });

  it('scoped @mui/material/Button collapses to package "@mui/material" with subpath specifier', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-deep-imports',
      sourceDirs: [FIXTURE_SRC],
      sharedConfig: SHARED_ALL,
      depth: 'direct',
      packageJsonPath: FIXTURE_PKG,
    });
    const mui = manifest.usage.packageDetails.find((d) => d.package === '@mui/material');
    expect(mui).toBeDefined();
    expect(mui!.deepImports).toEqual(['@mui/material/Button']);
  });

  it('react/jsx-runtime stays in deepImports on the manifest, but detector skips it', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-deep-imports',
      sourceDirs: [FIXTURE_SRC],
      sharedConfig: SHARED_ALL,
      depth: 'direct',
      packageJsonPath: FIXTURE_PKG,
    });
    // The manifest preserves the raw observation (collector is policy-free).
    const react = manifest.usage.packageDetails.find((d) => d.package === 'react');
    expect(react!.deepImports).toContain('react/jsx-runtime');

    // The analyzer applies the default allowlist and produces no finding.
    const report = analyzeProject(manifest);
    const flagged = report.deepImportBypass.map((d) => d.package);
    expect(flagged).not.toContain('react');
  });
});

// ─── local-graph propagation ─────────────────────────────────────────────────

describe('stress: deep-import propagation through local barrel re-exports', () => {
  it('local-graph mode preserves the deep specifier across a re-export hop', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-deep-imports',
      sourceDirs: [FIXTURE_SRC],
      sharedConfig: SHARED_ALL,
      depth: 'local-graph',
      packageJsonPath: FIXTURE_PKG,
    });

    const lodash = manifest.usage.packageDetails.find((d) => d.package === 'lodash');
    // wrapper/index.ts re-exports `lodash/merge`. Must show up in addition to
    // the direct specifiers from index.ts and utils.ts.
    expect(lodash!.deepImports).toContain('lodash/merge');
    expect(lodash!.deepImports).toContain('lodash/get');
  });
});

// ─── Allowlist overrides ──────────────────────────────────────────────────────

describe('stress: deepImportAllowlist user overrides', () => {
  it('removing react from default allowlist by adding new entries does not unsuppress react/jsx-runtime', () => {
    const policy = mergePolicy({ deepImportAllowlist: ['lodash/get'] });
    const result = detectIssues({
      resolvedPackages: ['react', 'lodash'],
      packageDetails: [
        {
          package: 'react',
          importCount: 1,
          files: ['src/a.tsx'],
          via: 'direct',
          deepImports: ['react/jsx-runtime'],
        },
        {
          package: 'lodash',
          importCount: 1,
          files: ['src/a.ts'],
          via: 'direct',
          deepImports: ['lodash/get', 'lodash/cloneDeep'],
        },
      ],
      sharedDeclared: {
        react: { singleton: true },
        lodash: {},
      },
      installedVersions: {},
      policy,
    });

    // react default-allowlisted; user added lodash/get — only lodash/cloneDeep remains for lodash.
    expect(result.deepImportBypass).toHaveLength(1);
    expect(result.deepImportBypass[0].package).toBe('lodash');
    expect(result.deepImportBypass[0].specifiers).toEqual(['lodash/cloneDeep']);
  });

  it('full allowlist coverage suppresses the package entirely', () => {
    const policy = mergePolicy({
      deepImportAllowlist: ['lodash/get', 'lodash/cloneDeep'],
    });
    const result = detectIssues({
      resolvedPackages: ['lodash'],
      packageDetails: [{
        package: 'lodash',
        importCount: 1,
        files: ['src/a.ts'],
        via: 'direct',
        deepImports: ['lodash/get', 'lodash/cloneDeep'],
      }],
      sharedDeclared: { lodash: {} },
      installedVersions: {},
      policy,
    });

    expect(result.deepImportBypass).toHaveLength(0);
  });
});

// ─── Bulk specifiers within one package ───────────────────────────────────────

describe('stress: many distinct deep specifiers within one package', () => {
  it('aggregator preserves all 50 distinct subpaths and detector reports them', () => {
    const specifiers = Array.from({ length: 50 }, (_, i) => `lodash/op${i}`);
    const result = detectIssues({
      resolvedPackages: ['lodash'],
      packageDetails: [{
        package: 'lodash',
        importCount: 50,
        files: Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`),
        via: 'direct',
        deepImports: specifiers,
      }],
      sharedDeclared: { lodash: { singleton: true } },
      installedVersions: {},
      policy: mergePolicy(),
    });

    expect(result.deepImportBypass).toHaveLength(1);
    expect(result.deepImportBypass[0].specifiers).toHaveLength(50);
    // Files array is bounded by the preview window in the detector but the
    // fileCount must equal the full input size.
    expect(result.deepImportBypass[0].fileCount).toBe(50);
  });
});

// ─── Negative case: not in shared ────────────────────────────────────────────

describe('stress: deep imports of unshared packages are silently allowed', () => {
  it('does not flag deep imports when the package is not declared in shared', () => {
    const result = detectIssues({
      resolvedPackages: ['lodash'],
      packageDetails: [{
        package: 'lodash',
        importCount: 1,
        files: ['src/a.ts'],
        via: 'direct',
        deepImports: ['lodash/cloneDeep'],
      }],
      sharedDeclared: {},
      installedVersions: {},
      policy: mergePolicy(),
    });

    // Without a shared declaration the bypass concept does not apply —
    // every import already bundles into the consumer.
    expect(result.deepImportBypass).toHaveLength(0);
  });
});
