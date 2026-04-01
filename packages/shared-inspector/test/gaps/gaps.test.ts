/**
 * Tests covering the three gaps identified in v0.1 analysis:
 *
 *  Gap 1 — eager: true without singleton: true → new eagerRisks category
 *  Gap 2 — TypeScript path aliases (@components/*, @hooks/*) → packages
 *           behind aliases now visible in local-graph + tsconfigPath mode
 *  Gap 3 — workspacePackages option → local monorepo packages excluded
 *           from resolvedPackages
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { detectIssues } from '../../src/analyzer/detect-issues.js';
import { analyzeProject } from '../../src/analyzer/analyze-project.js';
import { mergePolicy } from '../../src/analyzer/policy.js';
import { traverseLocalModules } from '../../src/collector/traverse-local-modules.js';
import { buildProjectManifest } from '../../src/collector/build-project-manifest.js';
import { loadTsConfigPaths } from '../../src/collector/resolve-tsconfig-paths.js';

const ALIASES_SRC      = join(import.meta.dirname, '../fixtures/mf-aliases/src');
const ALIASES_TSCONFIG = join(import.meta.dirname, '../fixtures/mf-aliases/tsconfig.json');
const CHECKOUT_SRC     = join(import.meta.dirname, '../fixtures/mf-checkout/src');
const CHECKOUT_PKG     = join(import.meta.dirname, '../fixtures/mf-checkout/package.json');

const policy = mergePolicy();

// ─── Gap 1: eager without singleton ──────────────────────────────────────────

describe('gap 1: eager risks', () => {
  it('flags eager: true without singleton: true', () => {
    const result = detectIssues({
      resolvedPackages: [],
      packageDetails: [],
      sharedDeclared: { react: { eager: true } },
      installedVersions: {},
      policy,
    });
    expect(result.eagerRisks).toContainEqual({ package: 'react' });
  });

  it('does NOT flag eager: true when singleton: true is also set', () => {
    const result = detectIssues({
      resolvedPackages: [],
      packageDetails: [],
      sharedDeclared: { react: { eager: true, singleton: true } },
      installedVersions: {},
      policy,
    });
    expect(result.eagerRisks).toHaveLength(0);
  });

  it('does NOT flag package without eager: true', () => {
    const result = detectIssues({
      resolvedPackages: [],
      packageDetails: [],
      sharedDeclared: { react: { singleton: true } },
      installedVersions: {},
      policy,
    });
    expect(result.eagerRisks).toHaveLength(0);
  });

  it('flags multiple eager packages at once', () => {
    const result = detectIssues({
      resolvedPackages: [],
      packageDetails: [],
      sharedDeclared: {
        react: { eager: true },
        'react-dom': { eager: true },
        mobx: { eager: true, singleton: true }, // safe — has singleton
      },
      installedVersions: {},
      policy,
    });
    const names = result.eagerRisks.map((r) => r.package);
    expect(names).toContain('react');
    expect(names).toContain('react-dom');
    expect(names).not.toContain('mobx');
  });

  it('eagerRisksCount in summary matches eagerRisks array length', () => {
    const manifest = {
      schemaVersion: 1 as const,
      generatedAt: new Date().toISOString(),
      project: { name: 'test', root: '.', kind: 'unknown' as const },
      source: { depth: 'direct' as const, sourceDirs: [], filesScanned: 0 },
      usage: { directPackages: [], resolvedPackages: [], packageDetails: [] },
      shared: {
        declared: { react: { eager: true }, mobx: { eager: true, singleton: true } },
        source: 'explicit' as const,
      },
      versions: { declared: {}, installed: {} },
    };
    const report = analyzeProject(manifest);
    expect(report.eagerRisks.length).toBe(1);
    expect(report.summary.eagerRisksCount).toBe(1);
  });

  it('eagerRisks appear in formatReport output', async () => {
    const { formatReport } = await import('../../src/reporter/format-report.js');
    const report = {
      unused: [], candidates: [], mismatched: [], singletonRisks: [],
      eagerRisks: [{ package: 'react' }],
      summary: {
        totalShared: 1, usedShared: 0,
        unusedCount: 0, candidatesCount: 0, mismatchedCount: 0,
        singletonRisksCount: 0, eagerRisksCount: 1,
      },
    };
    const output = formatReport(report);
    expect(output).toContain('Eager Risk — react');
    expect(output).toContain('react');
    expect(output).toContain('eager: true without singleton: true');
  });
});

// ─── Gap 2: TypeScript path aliases ──────────────────────────────────────────

describe('gap 2: TypeScript path aliases', () => {
  it('loadTsConfigPaths parses aliases from tsconfig.json', () => {
    const paths = loadTsConfigPaths(ALIASES_TSCONFIG);
    expect(paths).not.toBeNull();
    const patterns = paths!.aliases.map((a) => a.pattern);
    expect(patterns).toContain('@components/');
    expect(patterns).toContain('@hooks/');
  });

  it('returns null for missing tsconfig', () => {
    const paths = loadTsConfigPaths('/non/existent/tsconfig.json');
    expect(paths).toBeNull();
  });

  it('WITHOUT tsconfigPath: @components/Button treated as external package name', async () => {
    const results = await traverseLocalModules({ sourceDirs: [ALIASES_SRC] });
    const packages = results.map((r) => r.package);
    // Without tsconfigPath the alias specifier is normalised to a package name
    // '@components/Button' → '@components/Button' (looks like an external package)
    expect(packages).toContain('@components/Button');
  });

  it('WITH tsconfigPath: follows @components/* alias and finds styled-components', async () => {
    const results = await traverseLocalModules({
      sourceDirs: [ALIASES_SRC],
      tsconfigPath: ALIASES_TSCONFIG,
    });
    const packages = results.map((r) => r.package);
    expect(packages).toContain('styled-components');
  });

  it('WITH tsconfigPath: follows @hooks/* alias and finds @tanstack/react-query', async () => {
    const results = await traverseLocalModules({
      sourceDirs: [ALIASES_SRC],
      tsconfigPath: ALIASES_TSCONFIG,
    });
    const packages = results.map((r) => r.package);
    expect(packages).toContain('@tanstack/react-query');
  });

  it('WITH tsconfigPath: aliased local modules not added as external packages', async () => {
    const results = await traverseLocalModules({
      sourceDirs: [ALIASES_SRC],
      tsconfigPath: ALIASES_TSCONFIG,
    });
    const packages = results.map((r) => r.package);
    // @components/Button and @hooks/useData are local — should NOT appear as packages
    expect(packages).not.toContain('@components/Button');
    expect(packages).not.toContain('@hooks/useData');
  });

  it('WITH tsconfigPath: direct external imports (react) still found', async () => {
    const results = await traverseLocalModules({
      sourceDirs: [ALIASES_SRC],
      tsconfigPath: ALIASES_TSCONFIG,
    });
    const packages = results.map((r) => r.package);
    expect(packages).toContain('react');
  });

  it('buildProjectManifest propagates tsconfigPath to traverser', async () => {
    const manifest = await buildProjectManifest({
      name: 'aliases-test',
      sourceDirs: [ALIASES_SRC],
      depth: 'local-graph',
      tsconfigPath: ALIASES_TSCONFIG,
      packageJsonPath: CHECKOUT_PKG,
    });
    expect(manifest.usage.resolvedPackages).toContain('styled-components');
    expect(manifest.usage.resolvedPackages).toContain('@tanstack/react-query');
  });
});

// ─── Gap 3: Workspace packages ───────────────────────────────────────────────

describe('gap 3: workspacePackages', () => {
  it('excludes exact workspace package from resolvedPackages', async () => {
    const results = await traverseLocalModules({
      sourceDirs: [CHECKOUT_SRC],
      workspacePackages: ['mobx'],
    });
    const packages = results.map((r) => r.package);
    expect(packages).not.toContain('mobx');
    expect(packages).toContain('mobx-react'); // not in workspacePackages
  });

  it('excludes workspace packages matching @scope/* glob', async () => {
    const results = await traverseLocalModules({
      sourceDirs: [CHECKOUT_SRC],
      workspacePackages: ['@tanstack/*'],
    });
    // no @tanstack in checkout fixture — should not crash
    expect(results).toBeDefined();
  });

  it('workspacePackages does not affect ignore list — both work independently', async () => {
    const results = await traverseLocalModules({
      sourceDirs: [CHECKOUT_SRC],
      ignore: ['axios'],
      workspacePackages: ['mobx'],
    });
    const packages = results.map((r) => r.package);
    expect(packages).not.toContain('axios');  // excluded by ignore
    expect(packages).not.toContain('mobx');   // excluded by workspacePackages
    expect(packages).toContain('react');       // not excluded
  });

  it('buildProjectManifest propagates workspacePackages to collector', async () => {
    const manifest = await buildProjectManifest({
      name: 'ws-test',
      sourceDirs: [CHECKOUT_SRC],
      depth: 'local-graph',
      workspacePackages: ['mobx', 'mobx-react'],
      packageJsonPath: CHECKOUT_PKG,
    });
    expect(manifest.usage.resolvedPackages).not.toContain('mobx');
    expect(manifest.usage.resolvedPackages).not.toContain('mobx-react');
    expect(manifest.usage.resolvedPackages).toContain('react');
  });

  it('workspacePackages also applied in direct mode', async () => {
    const manifest = await buildProjectManifest({
      name: 'ws-direct-test',
      sourceDirs: [CHECKOUT_SRC],
      depth: 'direct',
      workspacePackages: ['axios'],
      packageJsonPath: CHECKOUT_PKG,
    });
    expect(manifest.usage.resolvedPackages).not.toContain('axios');
  });
});
