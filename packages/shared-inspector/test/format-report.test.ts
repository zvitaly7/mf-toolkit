import { describe, it, expect } from 'vitest';
import { formatReport } from '../src/reporter/format-report.js';
import type { ProjectReport } from '../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<ProjectReport> = {}): ProjectReport {
  return {
    unused: [],
    candidates: [],
    mismatched: [],
    singletonRisks: [],
    eagerRisks: [],
    summary: {
      totalShared: 0,
      usedShared: 0,
      unusedCount: 0,
      candidatesCount: 0,
      mismatchedCount: 0,
      singletonRisksCount: 0,
      eagerRisksCount: 0,
    },
    ...overrides,
  };
}

// ─── Header ───────────────────────────────────────────────────────────────────

describe('formatReport — header', () => {
  it('renders project name and depth in header', () => {
    const output = formatReport(makeReport(), { name: 'checkout', depth: 'local-graph', filesScanned: 47 });
    expect(output).toContain('[MfSharedInspector] checkout');
    expect(output).toContain('depth: local-graph');
    expect(output).toContain('47 files scanned');
  });

  it('renders header without context', () => {
    const output = formatReport(makeReport());
    expect(output).toContain('[MfSharedInspector]');
  });
});

// ─── Version mismatch ─────────────────────────────────────────────────────────

describe('formatReport — version mismatch', () => {
  it('mismatch section appears before unused section', () => {
    const report = makeReport({
      mismatched: [{ package: 'react', configured: '^19.0.0', installed: '18.3.1' }],
      unused: [{ package: 'lodash', singleton: false }],
    });
    const output = formatReport(report);

    expect(output.indexOf('Version mismatch')).toBeLessThan(output.indexOf('Unused shared'));
  });

  it('mismatch entry uses ⚠ marker', () => {
    const report = makeReport({
      mismatched: [{ package: 'react', configured: '^19.0.0', installed: '18.3.1' }],
    });
    const output = formatReport(report);

    expect(output).toContain('⚠ react');
    expect(output).toContain('^19.0.0');
    expect(output).toContain('18.3.1');
  });
});

// ─── Unused ───────────────────────────────────────────────────────────────────

describe('formatReport — unused', () => {
  it('unused entry uses ✗ marker', () => {
    const report = makeReport({
      unused: [{ package: 'lodash', singleton: false }],
    });
    const output = formatReport(report);

    expect(output).toContain('✗ lodash');
  });

  it('shows singleton note for singleton packages', () => {
    const report = makeReport({
      unused: [{ package: 'react-query', singleton: true }],
    });
    const output = formatReport(report);

    expect(output).toContain('shared as singleton');
  });

  it('shows non-singleton note for regular packages', () => {
    const report = makeReport({
      unused: [{ package: 'lodash', singleton: false }],
    });
    const output = formatReport(report);

    expect(output).toContain('shared without singleton');
  });
});

// ─── Candidates ───────────────────────────────────────────────────────────────

describe('formatReport — candidates', () => {
  it('candidate entry uses → marker', () => {
    const report = makeReport({
      candidates: [{ package: 'mobx', importCount: 12, files: ['src/shared/index.ts'], via: 'direct' }],
    });
    const output = formatReport(report);

    expect(output).toContain('→ mobx');
  });

  it('shows via re-export path for reexport candidates', () => {
    const report = makeReport({
      candidates: [
        {
          package: 'mobx',
          importCount: 3,
          files: ['src/shared/index.ts'],
          via: 'reexport',
        },
      ],
    });
    const output = formatReport(report);

    expect(output).toContain('via re-export');
    expect(output).toContain('src/shared/index.ts');
  });

  it('shows import count and file count', () => {
    const report = makeReport({
      candidates: [
        {
          package: 'mobx',
          importCount: 8,
          files: ['src/store.ts', 'src/models/user.ts'],
          via: 'direct',
        },
      ],
    });
    const output = formatReport(report);

    expect(output).toContain('8 imports');
    expect(output).toContain('2 files');
  });
});

// ─── Singleton risks ──────────────────────────────────────────────────────────

describe('formatReport — singleton risks', () => {
  it('singleton risk entry uses ⚠ marker', () => {
    const report = makeReport({
      singletonRisks: [{ package: 'mobx' }],
    });
    const output = formatReport(report);

    expect(output).toContain('⚠ mobx');
    expect(output).toContain('singleton: true recommended');
  });
});

// ─── Summary ──────────────────────────────────────────────────────────────────

describe('formatReport — summary', () => {
  it('summary line always present', () => {
    const output = formatReport(makeReport());
    expect(output).toContain('Total:');
  });

  it('summary reflects report counters', () => {
    const report = makeReport({
      unused: [{ package: 'lodash', singleton: false }],
      mismatched: [{ package: 'react', configured: '^19.0.0', installed: '18.3.1' }],
      summary: {
        totalShared: 5,
        usedShared: 3,
        unusedCount: 1,
        candidatesCount: 0,
        mismatchedCount: 1,
        singletonRisksCount: 0,
      },
    });
    const output = formatReport(report);

    expect(output).toContain('5 shared');
    expect(output).toContain('1 unused');
    expect(output).toContain('1 mismatch');
  });
});

// ─── Empty report ─────────────────────────────────────────────────────────────

describe('formatReport — empty report', () => {
  it('renders clean message when no issues found', () => {
    const output = formatReport(makeReport());
    expect(output).toContain('No issues found');
  });

  it('does not render empty sections', () => {
    const output = formatReport(makeReport());
    expect(output).not.toContain('Version mismatch');
    expect(output).not.toContain('Unused shared');
    expect(output).not.toContain('Candidates');
    expect(output).not.toContain('Singleton risks');
  });
});
