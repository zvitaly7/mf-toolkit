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

  it('renders horizontal rule after header', () => {
    const output = formatFederationReport(makeReport());
    expect(output).toContain('─'.repeat(60));
  });
});

// ─── Empty report ─────────────────────────────────────────────────────────────

describe('formatFederationReport — empty report', () => {
  it('shows no issues message when all arrays empty', () => {
    const output = formatFederationReport(makeReport());
    expect(output).toContain('No federation-level issues found');
  });

  it('does not render any issue cards when no findings', () => {
    const output = formatFederationReport(makeReport());
    expect(output).not.toContain('Version Conflict');
    expect(output).not.toContain('Singleton Mismatch');
    expect(output).not.toContain('Host Gap');
    expect(output).not.toContain('Ghost Share');
  });
});

// ─── Version conflicts ────────────────────────────────────────────────────────

describe('formatFederationReport — version conflicts', () => {
  it('renders version conflict card with ⚠ and package name', () => {
    const output = formatFederationReport(makeReport({
      versionConflicts: [{ package: 'react', versions: { host: '^17.0.0', remote: '^18.0.0' } }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 1, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('⚠  Version Conflict — react');
    expect(output).toContain('host: ^17.0.0');
    expect(output).toContain('remote: ^18.0.0');
  });

  it('version conflict card shows risk and fix', () => {
    const output = formatFederationReport(makeReport({
      versionConflicts: [{ package: 'react', versions: { host: '^17.0.0', remote: '^18.0.0' } }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 1, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('→ Risk:');
    expect(output).toContain('💡 Fix:');
    expect(output).toContain('singleton: true');
    expect(output).toContain('requiredVersion:');
  });

  it('version conflicts appear before singleton mismatches', () => {
    const output = formatFederationReport(makeReport({
      versionConflicts: [{ package: 'react', versions: { host: '^17.0.0', remote: '^18.0.0' } }],
      singletonMismatches: [{ package: 'mobx', singletonIn: ['host'], nonSingletonIn: ['remote'] }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 1, singletonMismatchesCount: 1 },
    }));
    expect(output.indexOf('Version Conflict')).toBeLessThan(output.indexOf('Singleton Mismatch'));
  });

  it('shows known react risk for version conflict', () => {
    const output = formatFederationReport(makeReport({
      versionConflicts: [{ package: 'react', versions: { host: '^17.0.0', remote: '^18.0.0' } }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 1, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('Invalid hook call');
  });

  it('picks highest version for the fix snippet', () => {
    const output = formatFederationReport(makeReport({
      versionConflicts: [{ package: 'react', versions: { host: '^17.0.0', remote: '^18.0.0' } }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 1, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('^18.0.0');
  });
});

// ─── Singleton mismatches ─────────────────────────────────────────────────────

describe('formatFederationReport — singleton mismatches', () => {
  it('renders singleton mismatch card with ⚠ and package name', () => {
    const output = formatFederationReport(makeReport({
      singletonMismatches: [{ package: 'mobx', singletonIn: ['host'], nonSingletonIn: ['remote'] }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 1 },
    }));
    expect(output).toContain('⚠  Singleton Mismatch — mobx');
  });

  it('shows singletonIn and nonSingletonIn lists', () => {
    const output = formatFederationReport(makeReport({
      singletonMismatches: [{ package: 'mobx', singletonIn: ['host'], nonSingletonIn: ['remote'] }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 1 },
    }));
    expect(output).toContain('singleton in: [host]');
    expect(output).toContain('not singleton in: [remote]');
  });

  it('shows risk description and fix hint', () => {
    const output = formatFederationReport(makeReport({
      singletonMismatches: [{ package: 'mobx', singletonIn: ['host'], nonSingletonIn: ['remote'] }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 1 },
    }));
    expect(output).toContain('→ Risk:');
    expect(output).toContain('💡 Fix:');
    expect(output).toContain('singleton: true');
  });
});

// ─── Host gaps ────────────────────────────────────────────────────────────────

describe('formatFederationReport — host gaps', () => {
  it('renders host gap card with → and package name', () => {
    const output = formatFederationReport(makeReport({
      hostGaps: [{ package: 'axios', missingIn: ['host', 'remote'] }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 1, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('→  Host Gap — axios');
    expect(output).toContain('host');
    expect(output).toContain('remote');
  });

  it('shows risk and fix snippet for host gap', () => {
    const output = formatFederationReport(makeReport({
      hostGaps: [{ package: 'axios', missingIn: ['host', 'remote'] }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 1, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('→ Risk:');
    expect(output).toContain('💡 Fix:');
    expect(output).toContain('singleton: true');
  });
});

// ─── Ghost shares ─────────────────────────────────────────────────────────────

describe('formatFederationReport — ghost shares', () => {
  it('renders ghost share card with ✗ and package name', () => {
    const output = formatFederationReport(makeReport({
      ghostShares: [{ package: 'lodash', sharedBy: 'host', usedUnsharedBy: [] }],
      summary: { totalManifests: 2, ghostSharesCount: 1, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('✗  Ghost Share — lodash');
    expect(output).toContain('shared only by: host');
    expect(output).toContain('unused by all other MFs');
  });

  it('renders ghost share with usedUnsharedBy list', () => {
    const output = formatFederationReport(makeReport({
      ghostShares: [{ package: 'mobx', sharedBy: 'host', usedUnsharedBy: ['remote1', 'remote2'] }],
      summary: { totalManifests: 3, ghostSharesCount: 1, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('used unshared by: [remote1, remote2]');
  });

  it('shows fix hint pointing to sharedBy MF', () => {
    const output = formatFederationReport(makeReport({
      ghostShares: [{ package: 'lodash', sharedBy: 'host', usedUnsharedBy: [] }],
      summary: { totalManifests: 2, ghostSharesCount: 1, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    }));
    expect(output).toContain('Remove "lodash" from host\'s shared config');
  });

  it('ghost shares appear after host gaps', () => {
    const output = formatFederationReport(makeReport({
      hostGaps: [{ package: 'axios', missingIn: ['remote'] }],
      ghostShares: [{ package: 'lodash', sharedBy: 'host', usedUnsharedBy: [] }],
      summary: { totalManifests: 2, ghostSharesCount: 1, hostGapsCount: 1, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    }));
    expect(output.indexOf('Host Gap')).toBeLessThan(output.indexOf('Ghost Share'));
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
