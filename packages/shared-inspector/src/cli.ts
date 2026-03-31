#!/usr/bin/env node
/**
 * CLI entrypoint for @mf-toolkit/shared-inspector
 *
 * Usage:
 *   mf-inspector [options]                     — project analysis
 *   mf-inspector federation <manifest> ...     — cross-MF federation analysis
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildProjectManifest } from './collector/build-project-manifest.js';
import { analyzeProject } from './analyzer/analyze-project.js';
import { analyzeFederation } from './analyzer/analyze-federation.js';
import { formatReport } from './reporter/format-report.js';
import { formatFederationReport } from './reporter/format-federation-report.js';
import { writeManifest } from './reporter/write-report.js';
import type { SharedDepConfig, ProjectReport } from './types.js';

// ─── CLI args type ────────────────────────────────────────────────────────────

export interface CliArgs {
  command: 'project' | 'federation' | 'help';
  // project
  sourceDirs: string[];
  depth: 'direct' | 'local-graph';
  sharedConfig?: Record<string, SharedDepConfig>;
  tsconfigPath?: string;
  workspacePackages: string[];
  failOn?: 'mismatch' | 'unused' | 'any';
  writeManifest: boolean;
  outputDir: string;
  name?: string;
  // federation
  manifestFiles: string[];
}

// ─── Arg parser ───────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: 'project',
    sourceDirs: [],
    depth: 'local-graph',
    workspacePackages: [],
    writeManifest: false,
    outputDir: '.',
    manifestFiles: [],
  };

  if (argv[0] === 'federation') {
    args.command = 'federation';
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === '--help' || argv[i] === '-h') {
        args.command = 'help';
        break;
      }
      if (!argv[i].startsWith('-')) {
        args.manifestFiles.push(argv[i]);
      }
    }
    return args;
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        args.command = 'help';
        break;
      case '--source':
      case '-s':
        args.sourceDirs.push(...(argv[++i] ?? '').split(',').filter(Boolean));
        break;
      case '--depth':
        args.depth = (argv[++i] as 'direct' | 'local-graph') ?? 'local-graph';
        break;
      case '--shared':
        args.sharedConfig = parseSharedValue(argv[++i] ?? '');
        break;
      case '--tsconfig':
        args.tsconfigPath = argv[++i];
        break;
      case '--workspace-packages':
        args.workspacePackages.push(...(argv[++i] ?? '').split(',').filter(Boolean));
        break;
      case '--fail-on':
        args.failOn = argv[++i] as 'mismatch' | 'unused' | 'any';
        break;
      case '--write-manifest':
        args.writeManifest = true;
        break;
      case '--output-dir':
        args.outputDir = argv[++i] ?? '.';
        break;
      case '--name':
        args.name = argv[++i];
        break;
    }
  }

  if (args.sourceDirs.length === 0) {
    args.sourceDirs = ['./src'];
  }

  return args;
}

export function parseSharedValue(value: string): Record<string, SharedDepConfig> {
  if (!value) return {};
  if (value.endsWith('.json')) {
    const content = readFileSync(resolve(process.cwd(), value), 'utf-8');
    return JSON.parse(content) as Record<string, SharedDepConfig>;
  }
  return Object.fromEntries(
    value.split(',').filter(Boolean).map((p) => [p.trim(), {}]),
  );
}

export function shouldFail(report: ProjectReport, failOn: 'mismatch' | 'unused' | 'any'): boolean {
  if (failOn === 'mismatch') return report.mismatched.length > 0;
  if (failOn === 'unused') return report.unused.length > 0;
  return (
    report.mismatched.length > 0 ||
    report.unused.length > 0 ||
    report.candidates.length > 0 ||
    report.singletonRisks.length > 0 ||
    report.eagerRisks.length > 0
  );
}

// ─── Help text ────────────────────────────────────────────────────────────────

export const HELP = `Usage:
  mf-inspector [options]                     Analyse project shared config
  mf-inspector federation <manifest> ...     Cross-MF federation analysis

Project options:
  --source, -s <dirs>          Source dirs to scan, comma-separated (default: ./src)
  --depth <depth>              Scan depth: direct | local-graph (default: local-graph)
  --shared <packages|file>     Comma-separated package names or path to .json config
  --tsconfig <path>            tsconfig.json for path alias resolution
  --workspace-packages <pkgs>  Comma-separated workspace packages to exclude
  --name <name>                Project name (default: auto from package.json)
  --fail-on <rule>             Exit 1 when findings match: mismatch | unused | any
  --write-manifest             Write project-manifest.json to output dir
  --output-dir <dir>           Output directory for manifest (default: .)
  --help, -h                   Show this help

Federation:
  mf-inspector federation checkout.json catalog.json cart.json

Examples:
  mf-inspector
  mf-inspector --source ./src --shared react,react-dom --fail-on mismatch
  mf-inspector --shared ./shared-config.json --write-manifest
  mf-inspector federation ./manifests/checkout.json ./manifests/catalog.json
`;

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function main(
  argv: string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<number> {
  const args = parseArgs(argv);

  if (args.command === 'help') {
    write(HELP);
    return 0;
  }

  if (args.command === 'federation') {
    return runFederation(args, write);
  }

  return runProject(args, write);
}

// ─── Project runner ───────────────────────────────────────────────────────────

async function runProject(
  args: CliArgs,
  write: (s: string) => void,
): Promise<number> {
  let name = args.name;
  if (!name) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as { name?: string };
      name = pkg.name ?? 'project';
    } catch {
      name = 'project';
    }
  }

  const manifest = await buildProjectManifest({
    name,
    sourceDirs: args.sourceDirs,
    depth: args.depth,
    sharedConfig: args.sharedConfig,
    tsconfigPath: args.tsconfigPath,
    workspacePackages: args.workspacePackages,
  });

  const report = analyzeProject(manifest);

  write(formatReport(report, {
    name: manifest.project.name,
    depth: manifest.source.depth,
    filesScanned: manifest.source.filesScanned,
  }));

  if (args.writeManifest) {
    const outPath = resolve(args.outputDir, 'project-manifest.json');
    await writeManifest(manifest, outPath);
  }

  if (args.failOn && shouldFail(report, args.failOn)) return 1;

  return 0;
}

// ─── Federation runner ────────────────────────────────────────────────────────

async function runFederation(
  args: CliArgs,
  write: (s: string) => void,
): Promise<number> {
  if (args.manifestFiles.length === 0) {
    write('Error: federation command requires at least one manifest file\n');
    write('Usage: mf-inspector federation <manifest1.json> [manifest2.json...]\n');
    return 1;
  }

  const manifests = args.manifestFiles.map((file) => {
    const content = readFileSync(resolve(process.cwd(), file), 'utf-8');
    return JSON.parse(content);
  });

  const report = analyzeFederation(manifests);
  write(formatFederationReport(report));
  return 0;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

// Run only when executed directly as CLI (not when imported by tests or other modules)
const moduleUrl = new URL(import.meta.url);
const scriptUrl = process.argv[1] ? new URL(process.argv[1], 'file://') : null;

if (scriptUrl && moduleUrl.href === scriptUrl.href) {
  main(process.argv.slice(2)).then(
    (code) => { if (code !== 0) process.exit(code); },
    (err: Error) => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(1);
    },
  );
}
