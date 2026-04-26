import { describe, it, expect } from 'vitest';
import { scoreProjectReport, scoreFederationReport, formatScoreBlock } from '../../src/reporter/scoring.js';
import type { ProjectReport, FederationReport } from '../../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProjectReport(overrides: Partial<ProjectReport> = {}): ProjectReport {
  return {
    unused: [],
    candidates: [],
    mismatched: [],
    singletonRisks: [],
    eagerRisks: [],
    deepImportBypass: [],
    summary: {
      totalShared: 0, usedShared: 0, unusedCount: 0,
      candidatesCount: 0, mismatchedCount: 0, singletonRisksCount: 0, eagerRisksCount: 0,
      deepImportBypassCount: 0,
    },
    ...overrides,
  };
}

function makeFederationReport(overrides: Partial<FederationReport> = {}): FederationReport {
  return {
    ghostShares: [],
    hostGaps: [],
    versionConflicts: [],
    singletonMismatches: [],
    summary: {
      totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0,
      versionConflictsCount: 0, singletonMismatchesCount: 0,
    },
    ...overrides,
  };
}

// ─── scoreProjectReport ───────────────────────────────────────────────────────

describe('scoreProjectReport', () => {
  it('returns 100 for a clean report', () => {
    const { score, high, medium, low } = scoreProjectReport(makeProjectReport());
    expect(score).toBe(100);
    expect(high).toBe(0);
    expect(medium).toBe(0);
    expect(low).toBe(0);
  });

  it('labels a perfect report as HEALTHY', () => {
    expect(scoreProjectReport(makeProjectReport()).label).toBe('HEALTHY');
  });

  it('counts mismatched as high severity', () => {
    const report = makeProjectReport({
      mismatched: [
        { package: 'react', configured: '^18.0.0', installed: '17.0.2' },
        { package: 'mobx', configured: '^6.0.0', installed: '5.15.0' },
      ],
    });
    const { high, score } = scoreProjectReport(report);
    expect(high).toBe(2);
    expect(score).toBe(100 - 2 * 20); // 60
  });

  it('counts singletonRisks + eagerRisks + candidates as medium severity', () => {
    const report = makeProjectReport({
      singletonRisks: [{ package: 'mobx' }],
      eagerRisks: [{ package: 'react' }],
      candidates: [{ package: 'redux', importCount: 3, files: ['src/store.ts'], via: 'direct' }],
    });
    const { medium, score } = scoreProjectReport(report);
    expect(medium).toBe(3);
    expect(score).toBe(100 - 3 * 8); // 76
  });

  it('counts unused as low severity', () => {
    const report = makeProjectReport({
      unused: [
        { package: 'lodash', singleton: false },
        { package: 'axios', singleton: false },
      ],
    });
    const { low, score } = scoreProjectReport(report);
    expect(low).toBe(2);
    expect(score).toBe(100 - 2 * 3); // 94
  });

  it('clamps score to 0 for many critical issues', () => {
    const report = makeProjectReport({
      mismatched: [
        { package: 'react', configured: '^18.0.0', installed: '17.0.2' },
        { package: 'vue', configured: '^3.0.0', installed: '2.7.0' },
        { package: 'mobx', configured: '^6.0.0', installed: '5.0.0' },
        { package: 'redux', configured: '^4.0.0', installed: '3.7.0' },
        { package: 'zustand', configured: '^4.0.0', installed: '3.0.0' },
        { package: 'styled-components', configured: '^5.0.0', installed: '4.4.0' },
      ],
    });
    const { score } = scoreProjectReport(report);
    expect(score).toBe(0);
  });

  it('labels RISKY for score 40–69', () => {
    const report = makeProjectReport({
      mismatched: [
        { package: 'react', configured: '^18.0.0', installed: '17.0.2' },
        { package: 'mobx', configured: '^6.0.0', installed: '5.0.0' },
        { package: 'redux', configured: '^4.0.0', installed: '3.0.0' },
      ],
    });
    // 100 - 3*20 = 40
    expect(scoreProjectReport(report).label).toBe('RISKY');
  });

  it('labels GOOD for score 70–89', () => {
    const report = makeProjectReport({
      singletonRisks: [{ package: 'mobx' }, { package: 'react' }, { package: 'redux' }],
    });
    // 100 - 3*8 = 76
    expect(scoreProjectReport(report).label).toBe('GOOD');
  });

  it('labels CRITICAL for score below 40', () => {
    const report = makeProjectReport({
      mismatched: [
        { package: 'react', configured: '^18.0.0', installed: '17.0.2' },
        { package: 'vue', configured: '^3.0.0', installed: '2.0.0' },
        { package: 'mobx', configured: '^6.0.0', installed: '5.0.0' },
        { package: 'redux', configured: '^4.0.0', installed: '3.0.0' },
      ],
    });
    // 100 - 4*20 = 20
    expect(scoreProjectReport(report).label).toBe('CRITICAL');
  });

  it('combines all severities correctly', () => {
    const report = makeProjectReport({
      mismatched: [{ package: 'react', configured: '^18.0.0', installed: '17.0.2' }],
      singletonRisks: [{ package: 'mobx' }],
      unused: [{ package: 'lodash', singleton: false }, { package: 'axios', singleton: false }],
    });
    // high=1 (20), medium=1 (8), low=2 (6) → penalty=34, score=66
    const { score, high, medium, low } = scoreProjectReport(report);
    expect(high).toBe(1);
    expect(medium).toBe(1);
    expect(low).toBe(2);
    expect(score).toBe(66);
  });
});

// ─── scoreFederationReport ────────────────────────────────────────────────────

describe('scoreFederationReport', () => {
  it('returns 100 for a clean federation report', () => {
    const { score } = scoreFederationReport(makeFederationReport());
    expect(score).toBe(100);
  });

  it('counts versionConflicts as high severity', () => {
    const report = makeFederationReport({
      versionConflicts: [
        { package: 'react', versions: { host: '^18.0.0', remote: '^17.0.0' } },
      ],
    });
    const { high, score } = scoreFederationReport(report);
    expect(high).toBe(1);
    expect(score).toBe(80);
  });

  it('counts singletonMismatches + hostGaps as medium severity', () => {
    const report = makeFederationReport({
      singletonMismatches: [{ package: 'mobx', singletonIn: ['host'], nonSingletonIn: ['remote'] }],
      hostGaps: [{ package: 'axios', missingIn: ['remote'] }],
    });
    const { medium, score } = scoreFederationReport(report);
    expect(medium).toBe(2);
    expect(score).toBe(100 - 2 * 8); // 84
  });

  it('counts ghostShares as low severity', () => {
    const report = makeFederationReport({
      ghostShares: [
        { package: 'lodash', sharedBy: 'host', usedUnsharedBy: [] },
        { package: 'date-fns', sharedBy: 'remote', usedUnsharedBy: [] },
      ],
    });
    const { low, score } = scoreFederationReport(report);
    expect(low).toBe(2);
    expect(score).toBe(100 - 2 * 3); // 94
  });
});

// ─── formatScoreBlock ─────────────────────────────────────────────────────────

describe('formatScoreBlock', () => {
  it('includes the numeric score', () => {
    const score = { score: 62, label: 'RISKY' as const, high: 1, medium: 2, low: 0 };
    const output = formatScoreBlock(score, 'mismatch', 'dup libs', 'over-sharing');
    expect(output).toContain('62/100');
  });

  it('includes RISKY label with 🟠 icon', () => {
    const score = { score: 62, label: 'RISKY' as const, high: 1, medium: 2, low: 0 };
    const output = formatScoreBlock(score, 'mismatch', 'dup libs', 'over-sharing');
    expect(output).toContain('🟠');
    expect(output).toContain('RISKY');
  });

  it('includes HEALTHY label with ✅ icon', () => {
    const score = { score: 100, label: 'HEALTHY' as const, high: 0, medium: 0, low: 0 };
    const output = formatScoreBlock(score, 'mismatch', 'dup libs', 'over-sharing');
    expect(output).toContain('✅');
    expect(output).toContain('HEALTHY');
  });

  it('includes CRITICAL label with 🔴 icon', () => {
    const score = { score: 20, label: 'CRITICAL' as const, high: 4, medium: 0, low: 0 };
    const output = formatScoreBlock(score, 'mismatch', 'dup libs', 'over-sharing');
    expect(output).toContain('🔴');
    expect(output).toContain('CRITICAL');
  });

  it('renders issue breakdown with counts', () => {
    const score = { score: 62, label: 'RISKY' as const, high: 1, medium: 2, low: 4 };
    const output = formatScoreBlock(score, 'version mismatch', 'singleton gaps', 'over-sharing');
    expect(output).toContain('1 high');
    expect(output).toContain('2 medium');
    expect(output).toContain('4 low');
  });

  it('renders custom labels in breakdown', () => {
    const score = { score: 80, label: 'GOOD' as const, high: 1, medium: 0, low: 0 };
    const output = formatScoreBlock(score, 'version conflicts', 'host gaps', 'ghost shares');
    expect(output).toContain('version conflicts');
    expect(output).toContain('host gaps');
    expect(output).toContain('ghost shares');
  });
});

// ─── Integration: score appears in formatReport output ────────────────────────

describe('score integration in formatReport', () => {
  it('formatReport output contains Score line', async () => {
    const { formatReport } = await import('../../src/reporter/format-report.js');
    const report: ProjectReport = {
      unused: [], candidates: [], mismatched: [], singletonRisks: [], eagerRisks: [], deepImportBypass: [],
      summary: { totalShared: 0, usedShared: 0, unusedCount: 0, candidatesCount: 0, mismatchedCount: 0, singletonRisksCount: 0, eagerRisksCount: 0, deepImportBypassCount: 0 },
    };
    expect(formatReport(report)).toContain('Score:');
  });

  it('formatReport score reflects mismatched findings', async () => {
    const { formatReport } = await import('../../src/reporter/format-report.js');
    const report: ProjectReport = {
      unused: [],
      candidates: [],
      mismatched: [{ package: 'react', configured: '^18.0.0', installed: '17.0.2' }],
      singletonRisks: [],
      eagerRisks: [],
      deepImportBypass: [],
      summary: { totalShared: 1, usedShared: 0, unusedCount: 0, candidatesCount: 0, mismatchedCount: 1, singletonRisksCount: 0, eagerRisksCount: 0, deepImportBypassCount: 0 },
    };
    const output = formatReport(report);
    expect(output).toContain('80/100');
    expect(output).toContain('GOOD');
  });

  it('formatFederationReport output contains Score line', async () => {
    const { formatFederationReport } = await import('../../src/reporter/format-federation-report.js');
    const report: FederationReport = {
      ghostShares: [], hostGaps: [], versionConflicts: [], singletonMismatches: [],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    };
    expect(formatFederationReport(report)).toContain('Score:');
  });
});
