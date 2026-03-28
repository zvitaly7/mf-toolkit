/**
 * Stress / real-world complexity tests for shared-inspector.
 *
 * Uses the mf-complex fixture which models patterns found in production MF apps:
 *   - 3-level deep barrel chains
 *   - Diamond imports (same package via multiple paths)
 *   - 3-node circular imports
 *   - export * from 'pkg' (star re-exports)
 *   - direct-beats-reexport precedence
 *   - non-candidate packages (recharts)
 *   - scoped packages (@tanstack/*, @emotion/*)
 *   - multiple source dirs combined
 *   - complex semver ranges
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { traverseLocalModules } from '../../src/collector/traverse-local-modules.js';
import { buildProjectManifest } from '../../src/collector/build-project-manifest.js';
import { analyzeProject } from '../../src/analyzer/analyze-project.js';
import { detectIssues } from '../../src/analyzer/detect-issues.js';
import { mergePolicy } from '../../src/analyzer/policy.js';

const COMPLEX_SRC = join(import.meta.dirname, '../fixtures/mf-complex/src');
const COMPLEX_PKG = join(import.meta.dirname, '../fixtures/mf-complex/package.json');
const CHECKOUT_SRC = join(import.meta.dirname, '../fixtures/mf-checkout/src');
const CHECKOUT_PKG = join(import.meta.dirname, '../fixtures/mf-checkout/package.json');

// ─── Deep barrel chain ────────────────────────────────────────────────────────

describe('stress: deep barrel chain (3 levels)', () => {
  it('finds jotai reachable only via l1 → l2 → l3 → jotai', async () => {
    const results = await traverseLocalModules({ sourceDirs: [COMPLEX_SRC] });
    const packages = results.map((r) => r.package);
    expect(packages).toContain('jotai');
  });

  it('marks jotai as via: reexport (never directly imported)', async () => {
    const results = await traverseLocalModules({ sourceDirs: [COMPLEX_SRC] });
    const jotaiEntries = results.filter((r) => r.package === 'jotai');
    expect(jotaiEntries.length).toBeGreaterThan(0);
    expect(jotaiEntries.every((r) => r.via === 'reexport')).toBe(true);
  });

  it('does NOT find jotai in direct mode (hidden behind 3 relative hops)', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-complex',
      sourceDirs: [COMPLEX_SRC],
      depth: 'direct',
      packageJsonPath: COMPLEX_PKG,
    });
    expect(manifest.usage.resolvedPackages).not.toContain('jotai');
  });

  it('DOES find jotai in local-graph mode', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-complex',
      sourceDirs: [COMPLEX_SRC],
      depth: 'local-graph',
      packageJsonPath: COMPLEX_PKG,
    });
    expect(manifest.usage.resolvedPackages).toContain('jotai');
  });
});

// ─── export * from 'pkg' ─────────────────────────────────────────────────────

describe('stress: star re-exports (export * from)', () => {
  it('finds @emotion/react via export * from "@emotion/react"', async () => {
    const results = await traverseLocalModules({ sourceDirs: [COMPLEX_SRC] });
    const packages = results.map((r) => r.package);
    expect(packages).toContain('@emotion/react');
  });

  it('finds @emotion/styled via export * from "@emotion/styled"', async () => {
    const results = await traverseLocalModules({ sourceDirs: [COMPLEX_SRC] });
    const packages = results.map((r) => r.package);
    expect(packages).toContain('@emotion/styled');
  });

  it('marks star-reexported packages as via: reexport', async () => {
    const results = await traverseLocalModules({ sourceDirs: [COMPLEX_SRC] });
    const emotionEntries = results.filter((r) => r.package === '@emotion/react');
    expect(emotionEntries.length).toBeGreaterThan(0);
    expect(emotionEntries.every((r) => r.via === 'reexport')).toBe(true);
  });
});

// ─── Diamond import: direct beats reexport ───────────────────────────────────

describe('stress: diamond import — direct beats reexport', () => {
  it('finds @tanstack/react-query (used in two different files)', async () => {
    const results = await traverseLocalModules({ sourceDirs: [COMPLEX_SRC] });
    const packages = results.map((r) => r.package);
    expect(packages).toContain('@tanstack/react-query');
  });

  it('marks @tanstack/react-query as via: direct (direct import wins over reexport)', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-complex',
      sourceDirs: [COMPLEX_SRC],
      depth: 'local-graph',
      packageJsonPath: COMPLEX_PKG,
    });
    const detail = manifest.usage.packageDetails.find(
      (d) => d.package === '@tanstack/react-query',
    );
    expect(detail).toBeDefined();
    expect(detail!.via).toBe('direct');
  });

  it('@tanstack/react-query appears in directPackages (has at least one direct import)', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-complex',
      sourceDirs: [COMPLEX_SRC],
      depth: 'local-graph',
      packageJsonPath: COMPLEX_PKG,
    });
    expect(manifest.usage.directPackages).toContain('@tanstack/react-query');
  });
});

// ─── 3-node circular import ───────────────────────────────────────────────────

describe('stress: 3-node circular import (a → b → c → a)', () => {
  it('completes without hanging or throwing', async () => {
    await expect(
      traverseLocalModules({ sourceDirs: [COMPLEX_SRC] }),
    ).resolves.toBeDefined();
  });

  it('still finds packages declared inside the cycle', async () => {
    const results = await traverseLocalModules({ sourceDirs: [COMPLEX_SRC] });
    const packages = results.map((r) => r.package);
    // cycle3/a.ts exports redux, cycle3/b.ts exports @reduxjs/toolkit
    expect(packages).toContain('redux');
    expect(packages).toContain('@reduxjs/toolkit');
  });
});

// ─── Non-candidate packages ───────────────────────────────────────────────────

describe('stress: non-candidate packages', () => {
  it('recharts appears in resolvedPackages (it is imported)', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-complex',
      sourceDirs: [COMPLEX_SRC],
      depth: 'local-graph',
      packageJsonPath: COMPLEX_PKG,
    });
    expect(manifest.usage.resolvedPackages).toContain('recharts');
  });

  it('recharts does NOT appear in report.candidates (not in share-candidates list)', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-complex',
      sourceDirs: [COMPLEX_SRC],
      depth: 'local-graph',
      packageJsonPath: COMPLEX_PKG,
    });
    const report = analyzeProject(manifest);
    const candidateNames = report.candidates.map((c) => c.package);
    expect(candidateNames).not.toContain('recharts');
  });
});

// ─── Scoped packages ──────────────────────────────────────────────────────────

describe('stress: scoped packages', () => {
  it('finds @tanstack/react-table as a separate package from @tanstack/react-query', async () => {
    const results = await traverseLocalModules({ sourceDirs: [COMPLEX_SRC] });
    const packages = results.map((r) => r.package);
    expect(packages).toContain('@tanstack/react-table');
    expect(packages).toContain('@tanstack/react-query');
  });

  it('scope wildcard ignore (@tanstack/*) suppresses both @tanstack packages', async () => {
    const results = await traverseLocalModules({
      sourceDirs: [COMPLEX_SRC],
      ignore: ['@tanstack/*'],
    });
    const packages = results.map((r) => r.package);
    expect(packages).not.toContain('@tanstack/react-query');
    expect(packages).not.toContain('@tanstack/react-table');
  });

  it('@emotion/* packages not affected by @tanstack/* ignore', async () => {
    const results = await traverseLocalModules({
      sourceDirs: [COMPLEX_SRC],
      ignore: ['@tanstack/*'],
    });
    const packages = results.map((r) => r.package);
    expect(packages).toContain('@emotion/react');
  });
});

// ─── Multiple source dirs ─────────────────────────────────────────────────────

describe('stress: multiple source dirs', () => {
  it('scanning two separate projects together finds packages from both', async () => {
    const manifest = await buildProjectManifest({
      name: 'combined',
      sourceDirs: [COMPLEX_SRC, CHECKOUT_SRC],
      depth: 'local-graph',
      packageJsonPath: CHECKOUT_PKG,
    });
    // from mf-checkout
    expect(manifest.usage.resolvedPackages).toContain('mobx');
    expect(manifest.usage.resolvedPackages).toContain('axios');
    // from mf-complex
    expect(manifest.usage.resolvedPackages).toContain('jotai');
    expect(manifest.usage.resolvedPackages).toContain('recharts');
  });

  it('no package is listed twice in resolvedPackages when found in both dirs', async () => {
    const manifest = await buildProjectManifest({
      name: 'combined',
      sourceDirs: [COMPLEX_SRC, CHECKOUT_SRC],
      depth: 'local-graph',
      packageJsonPath: CHECKOUT_PKG,
    });
    const set = new Set(manifest.usage.resolvedPackages);
    expect(manifest.usage.resolvedPackages.length).toBe(set.size);
  });
});

// ─── Complex semver ranges ────────────────────────────────────────────────────

describe('stress: complex semver ranges', () => {
  const policy = mergePolicy();

  it('>=16.0.0 <18.0.0 satisfies 17.0.0 — no mismatch', () => {
    const result = detectIssues({
      resolvedPackages: [],
      packageDetails: [],
      sharedDeclared: { react: { requiredVersion: '>=16.0.0 <18.0.0' } },
      installedVersions: { react: '17.0.0' },
      policy,
    });
    expect(result.mismatched).toHaveLength(0);
  });

  it('>=16.0.0 <18.0.0 does NOT satisfy 18.0.0 — flags mismatch', () => {
    const result = detectIssues({
      resolvedPackages: [],
      packageDetails: [],
      sharedDeclared: { react: { requiredVersion: '>=16.0.0 <18.0.0' } },
      installedVersions: { react: '18.0.0' },
      policy,
    });
    expect(result.mismatched).toHaveLength(1);
    expect(result.mismatched[0].package).toBe('react');
  });

  it('tilde ~6.12.0 satisfies 6.12.5 — no mismatch', () => {
    const result = detectIssues({
      resolvedPackages: [],
      packageDetails: [],
      sharedDeclared: { mobx: { requiredVersion: '~6.12.0' } },
      installedVersions: { mobx: '6.12.5' },
      policy,
    });
    expect(result.mismatched).toHaveLength(0);
  });

  it('tilde ~6.12.0 does NOT satisfy 6.13.0 — flags mismatch', () => {
    const result = detectIssues({
      resolvedPackages: [],
      packageDetails: [],
      sharedDeclared: { mobx: { requiredVersion: '~6.12.0' } },
      installedVersions: { mobx: '6.13.0' },
      policy,
    });
    expect(result.mismatched).toHaveLength(1);
  });

  it('caret ^18.0.0 satisfies 18.3.1 — no mismatch', () => {
    const result = detectIssues({
      resolvedPackages: [],
      packageDetails: [],
      sharedDeclared: { react: { requiredVersion: '^18.0.0' } },
      installedVersions: { react: '18.3.1' },
      policy,
    });
    expect(result.mismatched).toHaveLength(0);
  });

  it('OR range >=16.0.0 <18.0.0 || >=19.0.0 satisfies 19.1.0 — no mismatch', () => {
    const result = detectIssues({
      resolvedPackages: [],
      packageDetails: [],
      sharedDeclared: { react: { requiredVersion: '>=16.0.0 <18.0.0 || >=19.0.0' } },
      installedVersions: { react: '19.1.0' },
      policy,
    });
    expect(result.mismatched).toHaveLength(0);
  });

  it('OR range >=16.0.0 <18.0.0 || >=19.0.0 does NOT satisfy 18.3.1 — flags mismatch', () => {
    const result = detectIssues({
      resolvedPackages: [],
      packageDetails: [],
      sharedDeclared: { react: { requiredVersion: '>=16.0.0 <18.0.0 || >=19.0.0' } },
      installedVersions: { react: '18.3.1' },
      policy,
    });
    expect(result.mismatched).toHaveLength(1);
  });

  it('invalid semver range skips silently — no throw, no false positive', () => {
    expect(() => {
      detectIssues({
        resolvedPackages: [],
        packageDetails: [],
        sharedDeclared: { 'some-lib': { requiredVersion: 'not-a-semver-range' } },
        installedVersions: { 'some-lib': '1.0.0' },
        policy,
      });
    }).not.toThrow();

    const result = detectIssues({
      resolvedPackages: [],
      packageDetails: [],
      sharedDeclared: { 'some-lib': { requiredVersion: 'not-a-semver-range' } },
      installedVersions: { 'some-lib': '1.0.0' },
      policy,
    });
    expect(result.mismatched).toHaveLength(0);
  });
});

// ─── All findings simultaneously ─────────────────────────────────────────────

describe('stress: all 4 finding categories at once', () => {
  it('produces unused, candidates, mismatched and singletonRisks simultaneously', () => {
    const policy = mergePolicy();

    const result = detectIssues({
      // resolvedPackages: mobx (candidate) + axios (found but not shared, not a candidate)
      resolvedPackages: ['mobx', 'axios'],
      packageDetails: [
        { package: 'mobx',  importCount: 5, files: ['src/store.ts'], via: 'direct' },
        { package: 'axios', importCount: 1, files: ['src/api.ts'],   via: 'direct' },
      ],
      sharedDeclared: {
        // unused: lodash not in resolvedPackages
        lodash: {},
        // mismatched: react installed 18, requires ^19
        react: { singleton: true, requiredVersion: '^19.0.0' },
        // singletonRisk: redux shared without singleton
        redux: {},
      },
      installedVersions: {
        react: '18.3.1',
        redux: '5.0.0',
      },
      policy,
    });

    // All 4 categories populated
    expect(result.unused.map((u) => u.package)).toContain('lodash');
    expect(result.candidates.map((c) => c.package)).toContain('mobx');
    expect(result.mismatched.map((m) => m.package)).toContain('react');
    expect(result.singletonRisks.map((r) => r.package)).toContain('redux');
  });
});

// ─── Full integration on mf-complex ──────────────────────────────────────────

describe('stress: full integration pipeline on mf-complex', () => {
  it('buildProjectManifest + analyzeProject produces a valid report', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-complex',
      sourceDirs: [COMPLEX_SRC],
      depth: 'local-graph',
      packageJsonPath: COMPLEX_PKG,
      sharedConfig: {
        react:    { singleton: true, requiredVersion: '^19.0.0' }, // mismatch (18 installed)
        'react-dom': { singleton: true },
        redux:    {},                                               // singletonRisk
        lodash:   {},                                               // unused
      },
    });

    const report = analyzeProject(manifest, {
      alwaysShared: ['react', 'react-dom'],
    });

    // lodash not in mf-complex sources → unused
    expect(report.unused.map((u) => u.package)).toContain('lodash');

    // redux has global state → singletonRisk
    expect(report.singletonRisks.map((r) => r.package)).toContain('redux');

    // packages like zustand, jotai, @emotion/react etc. should appear as candidates
    const candidateNames = report.candidates.map((c) => c.package);
    expect(candidateNames.length).toBeGreaterThan(0);

    // summary totals are consistent
    expect(report.summary.unusedCount).toBe(report.unused.length);
    expect(report.summary.candidatesCount).toBe(report.candidates.length);
    expect(report.summary.mismatchedCount).toBe(report.mismatched.length);
    expect(report.summary.singletonRisksCount).toBe(report.singletonRisks.length);
  });

  it('manifest is JSON-serialisable (survives round-trip)', async () => {
    const manifest = await buildProjectManifest({
      name: 'mf-complex',
      sourceDirs: [COMPLEX_SRC],
      depth: 'local-graph',
      packageJsonPath: COMPLEX_PKG,
    });
    const roundtripped = JSON.parse(JSON.stringify(manifest));
    expect(roundtripped).toEqual(manifest);
  });
});
