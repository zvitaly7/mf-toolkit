import { describe, it, expect } from 'vitest';
import { formatFederationReport } from '../../src/reporter/format-federation-report.js';
import type { FederationReport } from '../../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<FederationReport> = {}): FederationReport {
  return {
    ghostShares: [],
    hostGaps: [],
    versionConflicts: [],
    singletonMismatches: [],
    summary: {
      totalManifests: 2,
      ghostSharesCount: 0,
      hostGapsCount: 0,
      versionConflictsCount: 0,
      singletonMismatchesCount: 0,
    },
    ...overrides,
  };
}

// ─── Header ───────────────────────────────────────────────────────────────────

describe('formatFederationReport — header', () => {
  it('renders federation header with MF count', () => {
    const output = formatFederationReport(makeReport());
    expect(output).toContain('[MfSharedInspector] federation analysis');
    expect(output).toContain('2 MFs');
  });

  it('reflects totalManifests in header', () => {
    const output = formatFederationReport(
      makeReport({ summary: { totalManifests: 5, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 0 } }),
    );
    expect(output).toContain('5 MFs');
  });
});

// ─── Empty report ─────────────────────────────────────────────────────────────

describe('formatFederationReport — empty report', () => {
  it('shows no issues message when all arrays empty', () => {
    const output = formatFederationReport(makeReport());
    expect(output).toContain('No federation-level issues found');
  });

  it('does not render any section headers when no findings', () => {
    const output = formatFederationReport(makeReport());
    expect(output).not.toContain('Version conflicts');
    expect(output).not.toContain('Singleton mismatches');
    expect(output).not.toContain('Host gaps');
    expect(output).not.toContain('Ghost shares');
  });
});

// ─── Version conflicts ────────────────────────────────────────────────────────

describe('formatFederationReport — version conflicts', () => {
  it('renders version conflict section with ⚠ marker', () => {
    const output = formatFederationReport(makeReport({
      versionConflicts: [{ package: 'react', versions: { host: '^17.0.0', remote: '^18.0.0' } }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 1, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('Version conflicts');
    expect(output).toContain('⚠ react');
    expect(output).toContain('host: ^17.0.0');
    expect(output).toContain('remote: ^18.0.0');
  });

  it('version conflicts appear before singleton mismatches', () => {
    const output = formatFederationReport(makeReport({
      versionConflicts: [{ package: 'react', versions: { host: '^17.0.0', remote: '^18.0.0' } }],
      singletonMismatches: [{ package: 'mobx', singletonIn: ['host'], nonSingletonIn: ['remote'] }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 1, singletonMismatchesCount: 1 },
    }));
    expect(output.indexOf('Version conflicts')).toBeLessThan(output.indexOf('Singleton mismatches'));
  });
});

// ─── Singleton mismatches ─────────────────────────────────────────────────────

describe('formatFederationReport — singleton mismatches', () => {
  it('renders singleton mismatch with singletonIn and nonSingletonIn', () => {
    const output = formatFederationReport(makeReport({
      singletonMismatches: [{ package: 'mobx', singletonIn: ['host'], nonSingletonIn: ['remote'] }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 1 },
    }));
    expect(output).toContain('Singleton mismatches');
    expect(output).toContain('⚠ mobx');
    expect(output).toContain('singleton in [host]');
    expect(output).toContain('not singleton in [remote]');
  });
});

// ─── Host gaps ────────────────────────────────────────────────────────────────

describe('formatFederationReport — host gaps', () => {
  it('renders host gap with → marker and MF list', () => {
    const output = formatFederationReport(makeReport({
      hostGaps: [{ package: 'axios', missingIn: ['host', 'remote'] }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 1, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('Host gaps');
    expect(output).toContain('→ axios');
    expect(output).toContain('host');
    expect(output).toContain('remote');
  });
});

// ─── Ghost shares ─────────────────────────────────────────────────────────────

describe('formatFederationReport — ghost shares', () => {
  it('renders ghost share with ✗ marker for unused-by-all case', () => {
    const output = formatFederationReport(makeReport({
      ghostShares: [{ package: 'lodash', sharedBy: 'host', usedUnsharedBy: [] }],
      summary: { totalManifests: 2, ghostSharesCount: 1, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('Ghost shares');
    expect(output).toContain('✗ lodash');
    expect(output).toContain('shared only by host');
    expect(output).toContain('unused by all other MFs');
  });

  it('renders ghost share with usedUnsharedBy list', () => {
    const output = formatFederationReport(makeReport({
      ghostShares: [{ package: 'mobx', sharedBy: 'host', usedUnsharedBy: ['remote1', 'remote2'] }],
      summary: { totalManifests: 3, ghostSharesCount: 1, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('used unshared by [remote1, remote2]');
  });

  it('ghost shares appear last (after host gaps)', () => {
    const output = formatFederationReport(makeReport({
      hostGaps: [{ package: 'axios', missingIn: ['remote'] }],
      ghostShares: [{ package: 'lodash', sharedBy: 'host', usedUnsharedBy: [] }],
      summary: { totalManifests: 2, ghostSharesCount: 1, hostGapsCount: 1, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    }));
    expect(output.indexOf('Host gaps')).toBeLessThan(output.indexOf('Ghost shares'));
  });
});

// ─── Summary line ─────────────────────────────────────────────────────────────

describe('formatFederationReport — summary', () => {
  it('summary line always present', () => {
    const output = formatFederationReport(makeReport());
    expect(output).toContain('Total:');
  });

  it('summary reflects all counters', () => {
    const output = formatFederationReport(makeReport({
      versionConflicts: [{ package: 'react', versions: { host: '^17.0.0', remote: '^18.0.0' } }],
      hostGaps: [{ package: 'axios', missingIn: ['host', 'remote'] }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 1, versionConflictsCount: 1, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('2 MFs');
    expect(output).toContain('1 version conflicts');
    expect(output).toContain('1 host gaps');
    expect(output).toContain('0 ghost shares');
  });
});
