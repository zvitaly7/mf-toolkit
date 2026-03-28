import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeProject } from '../../src/analyzer/analyze-project.js';
import type { ProjectManifest } from '../../src/types.js';

const MANIFESTS = join(import.meta.dirname, '../fixtures/manifests');

function loadManifest(name: string): ProjectManifest {
  return JSON.parse(readFileSync(join(MANIFESTS, name), 'utf-8')) as ProjectManifest;
}

// ─── Clean manifest ───────────────────────────────────────────────────────────

describe('analyzeProject — clean manifest', () => {
  it('returns zero findings when everything is correct', () => {
    const report = analyzeProject(loadManifest('clean.json'));

    expect(report.unused).toHaveLength(0);
    expect(report.candidates).toHaveLength(0);
    expect(report.mismatched).toHaveLength(0);
    expect(report.singletonRisks).toHaveLength(0);
  });

  it('summary reflects totals correctly', () => {
    const report = analyzeProject(loadManifest('clean.json'));

    expect(report.summary.totalShared).toBe(2);
    expect(report.summary.usedShared).toBe(2);
    expect(report.summary.unusedCount).toBe(0);
  });
});

// ─── Over-shared manifest ─────────────────────────────────────────────────────

describe('analyzeProject — over-shared manifest', () => {
  it('detects unused shared packages', () => {
    const report = analyzeProject(loadManifest('over-shared.json'));

    const unusedNames = report.unused.map(u => u.package);
    expect(unusedNames).toContain('lodash');
    expect(unusedNames).toContain('@tanstack/react-query');
    expect(unusedNames).toContain('rxjs');
    expect(unusedNames).toContain('date-fns');
  });

  it('does not flag react as unused (alwaysShared default)', () => {
    const report = analyzeProject(loadManifest('over-shared.json'));

    const unusedNames = report.unused.map(u => u.package);
    expect(unusedNames).not.toContain('react');
  });

  it('summary counts match finding lists', () => {
    const report = analyzeProject(loadManifest('over-shared.json'));

    expect(report.summary.unusedCount).toBe(report.unused.length);
    expect(report.summary.totalShared).toBe(5);
    expect(report.summary.usedShared).toBe(1); // only react is used
  });
});

// ─── With-reexports manifest ──────────────────────────────────────────────────

describe('analyzeProject — with-reexports manifest', () => {
  it('suggests candidates found via barrel re-exports', () => {
    const report = analyzeProject(loadManifest('with-reexports.json'));

    const candidateNames = report.candidates.map(c => c.package);
    expect(candidateNames).toContain('mobx');
    expect(candidateNames).toContain('mobx-react');
  });

  it('candidate via field reflects reexport origin', () => {
    const report = analyzeProject(loadManifest('with-reexports.json'));

    const mobx = report.candidates.find(c => c.package === 'mobx');
    expect(mobx?.via).toBe('reexport');
  });

  it('candidate includes file path from packageDetails', () => {
    const report = analyzeProject(loadManifest('with-reexports.json'));

    const mobx = report.candidates.find(c => c.package === 'mobx');
    expect(mobx?.files).toContain('src/shared/index.ts');
  });
});

// ─── Version-mismatch manifest ────────────────────────────────────────────────

describe('analyzeProject — version-mismatch manifest', () => {
  it('detects react version mismatch', () => {
    const report = analyzeProject(loadManifest('version-mismatch.json'));

    expect(report.mismatched).toContainEqual({
      package: 'react',
      configured: '^19.0.0',
      installed: '18.3.1',
    });
  });

  it('flags mobx as singleton risk (shared without singleton: true)', () => {
    const report = analyzeProject(loadManifest('version-mismatch.json'));

    expect(report.singletonRisks).toContainEqual({ package: 'mobx' });
  });

  it('does not flag react as singleton risk (singleton: true is set)', () => {
    const report = analyzeProject(loadManifest('version-mismatch.json'));

    const names = report.singletonRisks.map(r => r.package);
    expect(names).not.toContain('react');
  });
});

// ─── Policy options ───────────────────────────────────────────────────────────

describe('analyzeProject — policy options', () => {
  it('respects custom alwaysShared: package excluded from unused', () => {
    const report = analyzeProject(
      loadManifest('over-shared.json'),
      { alwaysShared: ['lodash'] },
    );

    const unusedNames = report.unused.map(u => u.package);
    expect(unusedNames).not.toContain('lodash');
  });

  it('additionalCandidates extends built-in list', () => {
    const report = analyzeProject(
      loadManifest('with-reexports.json'),
      { additionalCandidates: ['axios'] },
    );

    const candidateNames = report.candidates.map(c => c.package);
    expect(candidateNames).toContain('axios');
  });
});

// ─── Determinism ──────────────────────────────────────────────────────────────

describe('analyzeProject — determinism', () => {
  it('same manifest produces identical reports on repeated calls', () => {
    const manifest = loadManifest('version-mismatch.json');
    const report1 = analyzeProject(manifest);
    const report2 = analyzeProject(manifest);

    expect(report1).toEqual(report2);
  });
});
