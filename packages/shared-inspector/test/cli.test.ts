import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs, parseSharedValue, shouldFail, runInteractive, main, HELP } from '../src/cli.js';
import type { CliArgs, PromptFn } from '../src/cli.js';
import type { ProjectReport } from '../src/types.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../src/collector/build-project-manifest.js', () => ({
  buildProjectManifest: vi.fn(),
}));

vi.mock('../src/analyzer/analyze-project.js', () => ({
  analyzeProject: vi.fn(),
}));

vi.mock('../src/analyzer/analyze-federation.js', () => ({
  analyzeFederation: vi.fn(),
}));

vi.mock('../src/reporter/format-report.js', () => ({
  formatReport: vi.fn().mockReturnValue('[project report]\n'),
}));

vi.mock('../src/reporter/format-federation-report.js', () => ({
  formatFederationReport: vi.fn().mockReturnValue('[federation report]\n'),
}));

vi.mock('../src/reporter/write-report.js', () => ({
  writeManifest: vi.fn().mockResolvedValue(undefined),
}));

import { buildProjectManifest } from '../src/collector/build-project-manifest.js';
import { analyzeProject } from '../src/analyzer/analyze-project.js';
import { analyzeFederation } from '../src/analyzer/analyze-federation.js';
import { writeManifest } from '../src/reporter/write-report.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeManifest(name = 'checkout') {
  return {
    schemaVersion: 1,
    generatedAt: '2024-01-01T00:00:00.000Z',
    project: { name, root: '/cwd', kind: 'unknown' },
    source: { depth: 'local-graph', sourceDirs: ['./src'], filesScanned: 10 },
    usage: { directPackages: [], resolvedPackages: [], packageDetails: [] },
    shared: { declared: {}, source: 'explicit' },
    versions: { declared: {}, installed: {} },
  };
}

function makeReport(overrides: Partial<ProjectReport> = {}): ProjectReport {
  return {
    unused: [],
    candidates: [],
    mismatched: [],
    singletonRisks: [],
    eagerRisks: [],
    summary: {
      totalShared: 0, usedShared: 0, unusedCount: 0,
      candidatesCount: 0, mismatchedCount: 0,
      singletonRisksCount: 0, eagerRisksCount: 0,
    },
    ...overrides,
  };
}

// ─── parseArgs ────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('returns project command with defaults when no args', () => {
    const args = parseArgs([]);
    expect(args.command).toBe('project');
    expect(args.sourceDirs).toEqual(['./src']);
    expect(args.depth).toBe('local-graph');
    expect(args.writeManifest).toBe(false);
    expect(args.outputDir).toBe('.');
  });

  it('parses --source', () => {
    expect(parseArgs(['--source', './app']).sourceDirs).toEqual(['./app']);
    expect(parseArgs(['-s', './app']).sourceDirs).toEqual(['./app']);
  });

  it('parses --source with comma-separated dirs', () => {
    const args = parseArgs(['--source', './src,./lib']);
    expect(args.sourceDirs).toEqual(['./src', './lib']);
  });

  it('parses --depth', () => {
    expect(parseArgs(['--depth', 'direct']).depth).toBe('direct');
    expect(parseArgs(['--depth', 'local-graph']).depth).toBe('local-graph');
  });

  it('parses --shared as comma-separated packages', () => {
    const args = parseArgs(['--shared', 'react,react-dom']);
    expect(args.sharedConfig).toEqual({ react: {}, 'react-dom': {} });
  });

  it('parses --tsconfig', () => {
    expect(parseArgs(['--tsconfig', './tsconfig.json']).tsconfigPath).toBe('./tsconfig.json');
  });

  it('parses --workspace-packages as comma-separated', () => {
    const args = parseArgs(['--workspace-packages', '@org/a,@org/b']);
    expect(args.workspacePackages).toEqual(['@org/a', '@org/b']);
  });

  it('parses --fail-on', () => {
    expect(parseArgs(['--fail-on', 'mismatch']).failOn).toBe('mismatch');
    expect(parseArgs(['--fail-on', 'unused']).failOn).toBe('unused');
    expect(parseArgs(['--fail-on', 'any']).failOn).toBe('any');
  });

  it('parses --write-manifest', () => {
    expect(parseArgs(['--write-manifest']).writeManifest).toBe(true);
  });

  it('parses --output-dir', () => {
    expect(parseArgs(['--output-dir', './dist']).outputDir).toBe('./dist');
  });

  it('parses --name', () => {
    expect(parseArgs(['--name', 'my-app']).name).toBe('my-app');
  });

  it('parses --help / -h', () => {
    expect(parseArgs(['--help']).command).toBe('help');
    expect(parseArgs(['-h']).command).toBe('help');
  });

  it('parses --version / -v', () => {
    expect(parseArgs(['--version']).command).toBe('version');
    expect(parseArgs(['-v']).command).toBe('version');
  });

  it('throws on invalid --depth value', () => {
    expect(() => parseArgs(['--depth', 'invalid'])).toThrow('Invalid --depth value "invalid"');
  });

  it('throws on invalid --fail-on value', () => {
    expect(() => parseArgs(['--fail-on', 'wrong'])).toThrow('Invalid --fail-on value "wrong"');
  });

  it('parses federation command with manifest files', () => {
    const args = parseArgs(['federation', 'a.json', 'b.json']);
    expect(args.command).toBe('federation');
    expect(args.manifestFiles).toEqual(['a.json', 'b.json']);
  });

  it('parses federation --help', () => {
    const args = parseArgs(['federation', '--help']);
    expect(args.command).toBe('help');
  });

  it('ignores flags in federation positional args', () => {
    const args = parseArgs(['federation', 'a.json', 'b.json']);
    expect(args.manifestFiles).toEqual(['a.json', 'b.json']);
  });
});

// ─── parseSharedValue ─────────────────────────────────────────────────────────

describe('parseSharedValue', () => {
  it('returns empty object for empty string', () => {
    expect(parseSharedValue('')).toEqual({});
  });

  it('parses comma-separated package names', () => {
    expect(parseSharedValue('react,react-dom,lodash')).toEqual({
      react: {},
      'react-dom': {},
      lodash: {},
    });
  });

  it('trims whitespace from package names', () => {
    expect(parseSharedValue(' react , react-dom ')).toEqual({
      react: {},
      'react-dom': {},
    });
  });

  it('handles single package name', () => {
    expect(parseSharedValue('react')).toEqual({ react: {} });
  });
});

// ─── shouldFail ───────────────────────────────────────────────────────────────

describe('shouldFail', () => {
  it('mismatch: returns true only when mismatched is non-empty', () => {
    const clean = makeReport();
    const withMismatch = makeReport({ mismatched: [{ package: 'react', configured: '^18', installed: '17.0.0' }] });
    expect(shouldFail(clean, 'mismatch')).toBe(false);
    expect(shouldFail(withMismatch, 'mismatch')).toBe(true);
  });

  it('unused: returns true only when unused is non-empty', () => {
    const clean = makeReport();
    const withUnused = makeReport({ unused: [{ package: 'lodash', singleton: false }] });
    expect(shouldFail(clean, 'unused')).toBe(false);
    expect(shouldFail(withUnused, 'unused')).toBe(true);
  });

  it('any: returns true when any finding exists', () => {
    expect(shouldFail(makeReport(), 'any')).toBe(false);
    expect(shouldFail(makeReport({ mismatched: [{ package: 'react', configured: '^18', installed: '17.0.0' }] }), 'any')).toBe(true);
    expect(shouldFail(makeReport({ unused: [{ package: 'lodash', singleton: false }] }), 'any')).toBe(true);
    expect(shouldFail(makeReport({ candidates: [{ package: 'mobx', importCount: 3, files: ['src/a.ts'], via: 'direct' }] }), 'any')).toBe(true);
    expect(shouldFail(makeReport({ singletonRisks: [{ package: 'mobx' }] }), 'any')).toBe(true);
    expect(shouldFail(makeReport({ eagerRisks: [{ package: 'react-dom' }] }), 'any')).toBe(true);
  });
});

// ─── main ─────────────────────────────────────────────────────────────────────

describe('main', () => {
  beforeEach(() => {
    vi.mocked(buildProjectManifest).mockResolvedValue(makeManifest() as never);
    vi.mocked(analyzeProject).mockReturnValue(makeReport());
    vi.mocked(analyzeFederation).mockReturnValue({
      ghostShares: [], hostGaps: [], versionConflicts: [], singletonMismatches: [],
      summary: { totalManifests: 0, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('--version prints version string and returns 0', async () => {
    const chunks: string[] = [];
    const code = await main(['--version'], (s) => chunks.push(s));
    expect(code).toBe(0);
    expect(chunks.join('')).toContain('@mf-toolkit/shared-inspector');
  });

  it('-v prints version string and returns 0', async () => {
    const chunks: string[] = [];
    const code = await main(['-v'], (s) => chunks.push(s));
    expect(code).toBe(0);
    expect(chunks.join('')).toContain('@mf-toolkit/shared-inspector');
  });

  it('returns 1 and prints error on invalid --depth', async () => {
    const chunks: string[] = [];
    const code = await main(['--depth', 'bad'], (s) => chunks.push(s));
    expect(code).toBe(1);
    expect(chunks.join('')).toContain('Invalid --depth');
  });

  it('returns 1 and prints error on invalid --fail-on', async () => {
    const chunks: string[] = [];
    const code = await main(['--fail-on', 'bad'], (s) => chunks.push(s));
    expect(code).toBe(1);
    expect(chunks.join('')).toContain('Invalid --fail-on');
  });

  it('--help prints help and returns 0', async () => {
    const chunks: string[] = [];
    const code = await main(['--help'], (s) => chunks.push(s));
    expect(code).toBe(0);
    expect(chunks.join('')).toContain('mf-inspector');
    expect(chunks.join('')).toContain('--source');
  });

  it('-h prints help and returns 0', async () => {
    const chunks: string[] = [];
    const code = await main(['-h'], (s) => chunks.push(s));
    expect(code).toBe(0);
    expect(chunks.join('')).toContain('mf-inspector');
  });

  it('HELP constant contains expected sections', () => {
    expect(HELP).toContain('federation');
    expect(HELP).toContain('--fail-on');
    expect(HELP).toContain('--write-manifest');
  });

  it('runs project analysis and returns 0 on clean report', async () => {
    const chunks: string[] = [];
    const code = await main([], (s) => chunks.push(s));
    expect(code).toBe(0);
    expect(buildProjectManifest).toHaveBeenCalledOnce();
    expect(analyzeProject).toHaveBeenCalledOnce();
    expect(chunks.join('')).toBe('[project report]\n');
  });

  it('passes sourceDirs and depth to buildProjectManifest', async () => {
    await main(['--source', './app', '--depth', 'direct'], () => {});
    expect(buildProjectManifest).toHaveBeenCalledWith(expect.objectContaining({
      sourceDirs: ['./app'],
      depth: 'direct',
    }));
  });

  it('passes sharedConfig to buildProjectManifest', async () => {
    await main(['--shared', 'react,react-dom'], () => {});
    expect(buildProjectManifest).toHaveBeenCalledWith(expect.objectContaining({
      sharedConfig: { react: {}, 'react-dom': {} },
    }));
  });

  it('passes tsconfig and workspacePackages to buildProjectManifest', async () => {
    await main(['--tsconfig', './tsconfig.json', '--workspace-packages', '@org/a'], () => {});
    expect(buildProjectManifest).toHaveBeenCalledWith(expect.objectContaining({
      tsconfigPath: './tsconfig.json',
      workspacePackages: ['@org/a'],
    }));
  });

  it('uses --name when provided', async () => {
    await main(['--name', 'my-app'], () => {});
    expect(buildProjectManifest).toHaveBeenCalledWith(expect.objectContaining({ name: 'my-app' }));
  });

  it('returns 0 when --fail-on mismatch and no mismatches', async () => {
    vi.mocked(analyzeProject).mockReturnValue(makeReport());
    const code = await main(['--fail-on', 'mismatch'], () => {});
    expect(code).toBe(0);
  });

  it('returns 1 when --fail-on mismatch and mismatches exist', async () => {
    vi.mocked(analyzeProject).mockReturnValue(
      makeReport({ mismatched: [{ package: 'react', configured: '^18', installed: '17.0.0' }] }),
    );
    const code = await main(['--fail-on', 'mismatch'], () => {});
    expect(code).toBe(1);
  });

  it('returns 1 when --fail-on unused and unused packages exist', async () => {
    vi.mocked(analyzeProject).mockReturnValue(
      makeReport({ unused: [{ package: 'lodash', singleton: false }] }),
    );
    const code = await main(['--fail-on', 'unused'], () => {});
    expect(code).toBe(1);
  });

  it('returns 1 when --fail-on any and candidates exist', async () => {
    vi.mocked(analyzeProject).mockReturnValue(
      makeReport({ candidates: [{ package: 'mobx', importCount: 1, files: ['src/a.ts'], via: 'direct' }] }),
    );
    const code = await main(['--fail-on', 'any'], () => {});
    expect(code).toBe(1);
  });

  it('writes manifest when --write-manifest is passed', async () => {
    await main(['--write-manifest'], () => {});
    expect(writeManifest).toHaveBeenCalledOnce();
  });

  it('does not write manifest without --write-manifest', async () => {
    await main([], () => {});
    expect(writeManifest).not.toHaveBeenCalled();
  });

  it('federation: returns 1 when no manifest files', async () => {
    const chunks: string[] = [];
    const code = await main(['federation'], (s) => chunks.push(s));
    expect(code).toBe(1);
    expect(chunks.join('')).toContain('Error');
  });

  it('federation: returns 1 when manifest file does not exist', async () => {
    const chunks: string[] = [];
    const code = await main(['federation', 'does-not-exist.json'], (s) => chunks.push(s));
    expect(code).toBe(1);
    expect(chunks.join('')).toContain('cannot read file');
  });

  it('federation: prints help and returns 0', async () => {
    const chunks: string[] = [];
    const code = await main(['federation', '--help'], (s) => chunks.push(s));
    expect(code).toBe(0);
    expect(chunks.join('')).toContain('mf-inspector');
  });

  it('federation: fetches manifest from URL and returns 0', async () => {
    const manifest = makeManifest('remote-app');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(manifest),
    }));

    const chunks: string[] = [];
    const code = await main(['federation', 'https://cdn.example.com/manifest.json'], (s) => chunks.push(s));
    expect(code).toBe(0);
    expect(analyzeFederation).toHaveBeenCalledWith([manifest]);

    vi.unstubAllGlobals();
  });

  it('federation: fetches multiple manifests from URLs', async () => {
    const m1 = makeManifest('checkout');
    const m2 = makeManifest('cart');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(m1) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(m2) }),
    );

    const code = await main([
      'federation',
      'https://cdn.example.com/checkout.json',
      'https://cdn.example.com/cart.json',
    ], () => {});
    expect(code).toBe(0);
    expect(analyzeFederation).toHaveBeenCalledWith([m1, m2]);

    vi.unstubAllGlobals();
  });

  it('federation: returns 1 on HTTP error from URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }));

    const chunks: string[] = [];
    const code = await main(['federation', 'https://cdn.example.com/missing.json'], (s) => chunks.push(s));
    expect(code).toBe(1);
    expect(chunks.join('')).toContain('cannot fetch');
    expect(chunks.join('')).toContain('HTTP 404');

    vi.unstubAllGlobals();
  });

  it('federation: returns 1 on network error from URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const chunks: string[] = [];
    const code = await main(['federation', 'https://cdn.example.com/manifest.json'], (s) => chunks.push(s));
    expect(code).toBe(1);
    expect(chunks.join('')).toContain('cannot fetch');
    expect(chunks.join('')).toContain('ECONNREFUSED');

    vi.unstubAllGlobals();
  });

  it('federation: returns 1 when --fail-on mismatch and version conflicts exist', async () => {
    vi.mocked(analyzeFederation).mockReturnValue({
      ghostShares: [], hostGaps: [], singletonMismatches: [],
      versionConflicts: [{ package: 'react', versions: { checkout: '^17', cart: '^18' } }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 1, singletonMismatchesCount: 0 },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, text: async () => JSON.stringify(makeManifest()),
    }));

    const code = await main(
      ['federation', 'https://cdn.example.com/a.json', '--fail-on', 'mismatch'],
      () => {},
    );
    expect(code).toBe(1);
    vi.unstubAllGlobals();
  });

  it('federation: returns 0 when --fail-on mismatch and no version conflicts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, text: async () => JSON.stringify(makeManifest()),
    }));

    const code = await main(
      ['federation', 'https://cdn.example.com/a.json', '--fail-on', 'mismatch'],
      () => {},
    );
    expect(code).toBe(0);
    vi.unstubAllGlobals();
  });

  it('federation: returns 1 when --fail-on any and host gaps exist', async () => {
    vi.mocked(analyzeFederation).mockReturnValue({
      ghostShares: [], versionConflicts: [], singletonMismatches: [],
      hostGaps: [{ package: 'mobx', missingIn: ['cart'] }],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 1, versionConflictsCount: 0, singletonMismatchesCount: 0 },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, text: async () => JSON.stringify(makeManifest()),
    }));

    const code = await main(
      ['federation', 'https://cdn.example.com/a.json', '--fail-on', 'any'],
      () => {},
    );
    expect(code).toBe(1);
    vi.unstubAllGlobals();
  });

  it('federation: returns 1 when --min-score threshold not met', async () => {
    vi.mocked(analyzeFederation).mockReturnValue({
      ghostShares: [], hostGaps: [], singletonMismatches: [],
      versionConflicts: [
        { package: 'react', versions: { a: '^17', b: '^18' } },
        { package: 'react-dom', versions: { a: '^17', b: '^18' } },
      ],
      summary: { totalManifests: 2, ghostSharesCount: 0, hostGapsCount: 0, versionConflictsCount: 2, singletonMismatchesCount: 0 },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, text: async () => JSON.stringify(makeManifest()),
    }));

    const code = await main(
      ['federation', 'https://cdn.example.com/a.json', '--min-score', '90'],
      () => {},
    );
    expect(code).toBe(1);
    vi.unstubAllGlobals();
  });

  it('federation: returns 1 on invalid --fail-on', async () => {
    const chunks: string[] = [];
    const code = await main(['federation', 'a.json', '--fail-on', 'bad'], (s) => chunks.push(s));
    expect(code).toBe(1);
    expect(chunks.join('')).toContain('Invalid --fail-on');
  });

  it('federation: returns 1 on invalid --min-score', async () => {
    const chunks: string[] = [];
    const code = await main(['federation', 'a.json', '--min-score', 'abc'], (s) => chunks.push(s));
    expect(code).toBe(1);
    expect(chunks.join('')).toContain('Invalid --min-score');
  });

  it('project: passes kind to buildProjectManifest', async () => {
    await main(['--kind', 'host'], () => {});
    expect(buildProjectManifest).toHaveBeenCalledWith(expect.objectContaining({ kind: 'host' }));
  });

  it('project: returns 1 when --min-score not met', async () => {
    vi.mocked(analyzeProject).mockReturnValue(
      makeReport({ mismatched: [{ package: 'react', configured: '^18', installed: '17.0.0' }] }),
    );
    const code = await main(['--min-score', '90'], () => {});
    expect(code).toBe(1);
  });

  it('project: returns 0 when --min-score met', async () => {
    vi.mocked(analyzeProject).mockReturnValue(makeReport());
    const code = await main(['--min-score', '50'], () => {});
    expect(code).toBe(0);
  });

  it('project: returns 1 on invalid --kind', async () => {
    const chunks: string[] = [];
    const code = await main(['--kind', 'invalid'], (s) => chunks.push(s));
    expect(code).toBe(1);
    expect(chunks.join('')).toContain('Invalid --kind');
  });

  it('project: returns 1 on invalid --min-score', async () => {
    const chunks: string[] = [];
    const code = await main(['--min-score', '-5'], (s) => chunks.push(s));
    expect(code).toBe(1);
    expect(chunks.join('')).toContain('Invalid --min-score');
  });

  it('project: --json outputs valid JSON with findings and score', async () => {
    vi.mocked(analyzeProject).mockReturnValue(
      makeReport({ mismatched: [{ package: 'react', configured: '^18', installed: '17.0.0' }] }),
    );
    const chunks: string[] = [];
    const code = await main(['--json'], (s) => chunks.push(s));
    expect(code).toBe(0);
    const parsed = JSON.parse(chunks.join(''));
    expect(parsed.mismatched).toHaveLength(1);
    expect(parsed.score).toBeDefined();
    expect(parsed.score.score).toBeTypeOf('number');
    expect(parsed.score.label).toBeTypeOf('string');
  });

  it('project: --json output is pure JSON with no banner or spinner text', async () => {
    const chunks: string[] = [];
    await main(['--json'], (s) => chunks.push(s));
    const output = chunks.join('');
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('project: --json respects --fail-on and still exits 1', async () => {
    vi.mocked(analyzeProject).mockReturnValue(
      makeReport({ mismatched: [{ package: 'react', configured: '^18', installed: '17.0.0' }] }),
    );
    const code = await main(['--json', '--fail-on', 'mismatch'], () => {});
    expect(code).toBe(1);
  });

  it('federation: --json outputs valid JSON with findings and score', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, text: async () => JSON.stringify(makeManifest()),
    }));
    const chunks: string[] = [];
    const code = await main(
      ['federation', 'https://cdn.example.com/a.json', '--json'],
      (s) => chunks.push(s),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(chunks.join(''));
    expect(parsed.versionConflicts).toBeDefined();
    expect(parsed.score).toBeDefined();
    vi.unstubAllGlobals();
  });

  it('federation: mixes local files and URLs', async () => {
    const m1 = makeManifest('local-app');
    const m2 = makeManifest('remote-app');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(m2),
    }));

    // write a real temp file for the local manifest
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'mf-test-'));
    const localPath = join(dir, 'local.json');
    writeFileSync(localPath, JSON.stringify(m1));

    const code = await main(['federation', localPath, 'https://cdn.example.com/remote.json'], () => {});
    expect(code).toBe(0);
    expect(analyzeFederation).toHaveBeenCalledWith([m1, m2]);

    vi.unstubAllGlobals();
  });

  it('interactive: runs wizard and passes collected args to project runner', async () => {
    const answers = [
      './app',          // source dirs
      'direct',         // depth
      'react,react-dom',// shared
      '',               // tsconfig (skip)
      '',               // workspace packages (skip)
      'mismatch',       // fail-on
      'n',              // write manifest
    ];
    let i = 0;
    const mockPrompt: PromptFn = async () => answers[i++] ?? '';

    const code = await main(['--interactive'], () => {}, mockPrompt);
    expect(code).toBe(0);
    expect(buildProjectManifest).toHaveBeenCalledWith(expect.objectContaining({
      sourceDirs: ['./app'],
      depth: 'direct',
      sharedConfig: { react: {}, 'react-dom': {} },
    }));
  });

  it('interactive: -i flag also triggers wizard', async () => {
    const answers = ['', '', '', '', '', '', ''];
    let i = 0;
    const mockPrompt: PromptFn = async () => answers[i++] ?? '';
    const code = await main(['-i'], () => {}, mockPrompt);
    expect(code).toBe(0);
  });
});

// ─── runInteractive ───────────────────────────────────────────────────────────

describe('runInteractive', () => {
  function makeArgs(): CliArgs {
    return {
      command: 'project', interactive: true,
      sourceDirs: [], depth: 'local-graph',
      workspacePackages: [], writeManifest: false, outputDir: '.', manifestFiles: [],
    };
  }

  function makePrompt(answers: string[]): PromptFn {
    let i = 0;
    return async () => answers[i++] ?? '';
  }

  it('uses defaults when all answers are empty', async () => {
    const result = await runInteractive(makeArgs(), () => {}, makePrompt(['', '', '', '', '', '', '']));
    expect(result.sourceDirs).toEqual(['./src']);
    expect(result.depth).toBe('local-graph');
    expect(result.sharedConfig).toBeUndefined();
    expect(result.tsconfigPath).toBeUndefined();
    expect(result.workspacePackages).toEqual([]);
    expect(result.failOn).toBeUndefined();
    expect(result.writeManifest).toBe(false);
  });

  it('parses source dirs', async () => {
    const result = await runInteractive(makeArgs(), () => {}, makePrompt(['./src,./lib', '', '', '', '', '', '']));
    expect(result.sourceDirs).toEqual(['./src', './lib']);
  });

  it('sets depth to direct', async () => {
    const result = await runInteractive(makeArgs(), () => {}, makePrompt(['', 'direct', '', '', '', '', '']));
    expect(result.depth).toBe('direct');
  });

  it('parses shared packages', async () => {
    const result = await runInteractive(makeArgs(), () => {}, makePrompt(['', '', 'react,mobx', '', '', '', '']));
    expect(result.sharedConfig).toEqual({ react: {}, mobx: {} });
  });

  it('sets tsconfig path', async () => {
    const result = await runInteractive(makeArgs(), () => {}, makePrompt(['', '', '', './tsconfig.json', '', '', '']));
    expect(result.tsconfigPath).toBe('./tsconfig.json');
  });

  it('parses workspace packages', async () => {
    const result = await runInteractive(makeArgs(), () => {}, makePrompt(['', '', '', '', '@org/a,@org/b', '', '']));
    expect(result.workspacePackages).toEqual(['@org/a', '@org/b']);
  });

  it('sets fail-on', async () => {
    const resultMismatch = await runInteractive(makeArgs(), () => {}, makePrompt(['', '', '', '', '', 'mismatch', '']));
    expect(resultMismatch.failOn).toBe('mismatch');

    const resultAny = await runInteractive(makeArgs(), () => {}, makePrompt(['', '', '', '', '', 'any', '']));
    expect(resultAny.failOn).toBe('any');
  });

  it('ignores unknown fail-on values', async () => {
    const result = await runInteractive(makeArgs(), () => {}, makePrompt(['', '', '', '', '', 'invalid', '']));
    expect(result.failOn).toBeUndefined();
  });

  it('sets writeManifest to true on y', async () => {
    const result = await runInteractive(makeArgs(), () => {}, makePrompt(['', '', '', '', '', '', 'y']));
    expect(result.writeManifest).toBe(true);
  });

  it('asks for output dir when writeManifest is y', async () => {
    const result = await runInteractive(makeArgs(), () => {}, makePrompt(['', '', '', '', '', '', 'y', './dist']));
    expect(result.writeManifest).toBe(true);
    expect(result.outputDir).toBe('./dist');
  });

  it('keeps default output dir when writeManifest answer is y but dir is empty', async () => {
    const result = await runInteractive(makeArgs(), () => {}, makePrompt(['', '', '', '', '', '', 'y', '']));
    expect(result.outputDir).toBe('.');
  });

  it('prints header message', async () => {
    const chunks: string[] = [];
    await runInteractive(makeArgs(), (s) => chunks.push(s), makePrompt(['', '', '', '', '', '', '']));
    expect(chunks.join('')).toContain('[MfSharedInspector] Interactive setup');
  });
});
