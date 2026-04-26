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
    deepImportBypass: [],
    summary: {
      totalShared: 0,
      usedShared: 0,
      unusedCount: 0,
      candidatesCount: 0,
      mismatchedCount: 0,
      singletonRisksCount: 0,
      eagerRisksCount: 0,
      deepImportBypassCount: 0,
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

  it('renders horizontal rule after header', () => {
    const output = formatReport(makeReport());
    expect(output).toContain('─'.repeat(60));
  });
});

// ─── Version mismatch ─────────────────────────────────────────────────────────

describe('formatReport — version mismatch', () => {
  it('mismatch card appears before unused card', () => {
    const report = makeReport({
      mismatched: [{ package: 'react', configured: '^19.0.0', installed: '18.3.1' }],
      unused: [{ package: 'lodash', singleton: false }],
    });
    const output = formatReport(report);

    expect(output.indexOf('Version Mismatch')).toBeLessThan(output.indexOf('Unused Shared'));
  });

  it('mismatch card shows ⚠ and package name', () => {
    const report = makeReport({
      mismatched: [{ package: 'react', configured: '^19.0.0', installed: '18.3.1' }],
    });
    const output = formatReport(report);

    expect(output).toContain('⚠  Version Mismatch — react');
  });

  it('mismatch card shows configured and installed versions', () => {
    const report = makeReport({
      mismatched: [{ package: 'react', configured: '^19.0.0', installed: '18.3.1' }],
    });
    const output = formatReport(report);

    expect(output).toContain('^19.0.0');
    expect(output).toContain('18.3.1');
  });

  it('mismatch card shows risk description', () => {
    const report = makeReport({
      mismatched: [{ package: 'react', configured: '^18.0.0', installed: '17.0.2' }],
    });
    const output = formatReport(report);

    expect(output).toContain('→ Risk:');
  });

  it('mismatch card shows fix snippet with singleton and requiredVersion', () => {
    const report = makeReport({
      mismatched: [{ package: 'react', configured: '^18.0.0', installed: '17.0.2' }],
    });
    const output = formatReport(report);

    expect(output).toContain('💡 Fix:');
    expect(output).toContain('singleton: true');
    expect(output).toContain('requiredVersion: "^18.0.0"');
  });

  it('shows known risk message for react mismatch', () => {
    const report = makeReport({
      mismatched: [{ package: 'react', configured: '^18.0.0', installed: '17.0.2' }],
    });
    const output = formatReport(report);

    expect(output).toContain('Invalid hook call');
  });

  it('shows generic risk message for unknown package mismatch', () => {
    const report = makeReport({
      mismatched: [{ package: 'some-lib', configured: '^2.0.0', installed: '1.9.0' }],
    });
    const output = formatReport(report);

    expect(output).toContain('→ Risk:');
    expect(output).toContain('Version mismatch may cause');
  });
});

// ─── Unused ───────────────────────────────────────────────────────────────────

describe('formatReport — unused', () => {
  it('unused card shows ✗ and package name', () => {
    const report = makeReport({
      unused: [{ package: 'lodash', singleton: false }],
    });
    const output = formatReport(report);

    expect(output).toContain('✗  Unused Shared — lodash');
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

  it('shows remove fix hint', () => {
    const report = makeReport({
      unused: [{ package: 'lodash', singleton: false }],
    });
    const output = formatReport(report);

    expect(output).toContain('Remove "lodash" from shared config');
  });
});

// ─── Candidates ───────────────────────────────────────────────────────────────

describe('formatReport — candidates', () => {
  it('candidate card shows → and package name', () => {
    const report = makeReport({
      candidates: [{ package: 'mobx', importCount: 12, files: ['src/shared/index.ts'], via: 'direct' }],
    });
    const output = formatReport(report);

    expect(output).toContain('→  Not Shared — mobx');
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

    expect(output).toContain('via re-export in');
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

  it('shows risk description for candidate', () => {
    const report = makeReport({
      candidates: [{ package: 'mobx', importCount: 5, files: ['src/store.ts'], via: 'direct' }],
    });
    const output = formatReport(report);

    expect(output).toContain('→ Risk:');
  });

  it('shows fix snippet with singleton: true for candidate', () => {
    const report = makeReport({
      candidates: [{ package: 'mobx', importCount: 5, files: ['src/store.ts'], via: 'direct' }],
    });
    const output = formatReport(report);

    expect(output).toContain('💡 Fix:');
    expect(output).toContain('singleton: true');
  });

  it('shows known risk for mobx candidate', () => {
    const report = makeReport({
      candidates: [{ package: 'mobx', importCount: 5, files: ['src/store.ts'], via: 'direct' }],
    });
    const output = formatReport(report);

    expect(output).toContain('observables');
  });
});

// ─── Singleton risks ──────────────────────────────────────────────────────────

describe('formatReport — singleton risks', () => {
  it('singleton risk card shows ⚠ and package name', () => {
    const report = makeReport({
      singletonRisks: [{ package: 'mobx' }],
    });
    const output = formatReport(report);

    expect(output).toContain('⚠  Singleton Risk — mobx');
  });

  it('shows singleton: true is missing', () => {
    const report = makeReport({
      singletonRisks: [{ package: 'mobx' }],
    });
    const output = formatReport(report);

    expect(output).toContain('singleton: true is missing');
  });

  it('shows risk description and fix for singleton risk', () => {
    const report = makeReport({
      singletonRisks: [{ package: 'react' }],
    });
    const output = formatReport(report);

    expect(output).toContain('→ Risk:');
    expect(output).toContain('💡 Fix:');
    expect(output).toContain('singleton: true');
  });
});

// ─── Eager risks ──────────────────────────────────────────────────────────────

describe('formatReport — eager risks', () => {
  it('eager risk card shows ⚠ and package name', () => {
    const report = makeReport({
      eagerRisks: [{ package: 'react' }],
    });
    const output = formatReport(report);

    expect(output).toContain('⚠  Eager Risk — react');
  });

  it('shows eager: true without singleton: true', () => {
    const report = makeReport({
      eagerRisks: [{ package: 'react' }],
    });
    const output = formatReport(report);

    expect(output).toContain('eager: true without singleton: true');
  });

  it('shows fix snippet with both eager and singleton', () => {
    const report = makeReport({
      eagerRisks: [{ package: 'react' }],
    });
    const output = formatReport(report);

    expect(output).toContain('💡 Fix:');
    expect(output).toContain('singleton: true');
    expect(output).toContain('eager: true');
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
        eagerRisksCount: 0,
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

  it('does not render issue cards when report is empty', () => {
    const output = formatReport(makeReport());
    expect(output).not.toContain('Version Mismatch');
    expect(output).not.toContain('Unused Shared');
    expect(output).not.toContain('Not Shared');
    expect(output).not.toContain('Singleton Risk');
    expect(output).not.toContain('Eager Risk');
  });
});

// ─── diagnostics integration ──────────────────────────────────────────────────

describe('formatReport — diagnostics integration', () => {
  it('react-router singleton risk shows navigation risk', () => {
    const report = makeReport({
      singletonRisks: [{ package: 'react-router' }],
    });
    const output = formatReport(report);

    expect(output).toContain('navigation');
  });

  it('redux candidate shows store risk', () => {
    const report = makeReport({
      candidates: [{ package: 'redux', importCount: 3, files: ['src/store.ts'], via: 'direct' }],
    });
    const output = formatReport(report);

    expect(output).toContain('store');
  });

  it('styled-components singleton risk shows theme context risk', () => {
    const report = makeReport({
      singletonRisks: [{ package: 'styled-components' }],
    });
    const output = formatReport(report);

    expect(output).toContain('theme');
  });
});

// ─── Deep-import bypass section ──────────────────────────────────────────────

describe('formatReport — deep-import bypass', () => {
  it('renders a Deep Import Bypass card for the package', () => {
    const report = makeReport({
      deepImportBypass: [{
        package: 'lodash',
        specifiers: ['lodash/cloneDeep', 'lodash/debounce'],
        fileCount: 2,
        files: ['src/a.ts', 'src/b.ts'],
      }],
      summary: {
        totalShared: 1, usedShared: 1, unusedCount: 0, candidatesCount: 0,
        mismatchedCount: 0, singletonRisksCount: 0, eagerRisksCount: 0,
        deepImportBypassCount: 1,
      },
    });
    const output = formatReport(report);

    expect(output).toContain('Deep Import Bypass — lodash');
    expect(output).toContain('lodash/cloneDeep');
    expect(output).toContain('lodash/debounce');
    expect(output).toContain('2 files');
  });

  it('truncates the specifier list with "+ N more" when > 3', () => {
    const report = makeReport({
      deepImportBypass: [{
        package: 'rxjs',
        specifiers: ['rxjs/operators', 'rxjs/ajax', 'rxjs/webSocket', 'rxjs/fetch', 'rxjs/testing'],
        fileCount: 1,
        files: ['src/a.ts'],
      }],
      summary: {
        totalShared: 1, usedShared: 1, unusedCount: 0, candidatesCount: 0,
        mismatchedCount: 0, singletonRisksCount: 0, eagerRisksCount: 0,
        deepImportBypassCount: 1,
      },
    });
    const output = formatReport(report);

    expect(output).toContain('Deep Import Bypass — rxjs');
    expect(output).toContain('rxjs/operators');
    expect(output).toContain('+2 more');
  });

  it('uses package-specific risk text for known packages', () => {
    const report = makeReport({
      deepImportBypass: [{
        package: 'lodash',
        specifiers: ['lodash/cloneDeep'],
        fileCount: 1,
        files: ['src/a.ts'],
      }],
      summary: {
        totalShared: 1, usedShared: 1, unusedCount: 0, candidatesCount: 0,
        mismatchedCount: 0, singletonRisksCount: 0, eagerRisksCount: 0,
        deepImportBypassCount: 1,
      },
    });
    const output = formatReport(report);

    expect(output).toContain('lodash subpath');
  });
});
