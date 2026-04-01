import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CliArgs } from './types.js';
import type { SharedDepConfig } from '../types.js';

const VALID_DEPTHS = new Set(['direct', 'local-graph']);
const VALID_FAIL_ON = new Set(['mismatch', 'unused', 'any']);
const VALID_KINDS = new Set(['host', 'remote', 'unknown']);

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: 'project',
    interactive: false,
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
      const arg = argv[i];
      if (arg === '--help' || arg === '-h') {
        args.command = 'help';
        break;
      }
      if (arg === '--fail-on') {
        const val = argv[++i] ?? '';
        if (!VALID_FAIL_ON.has(val)) {
          throw new Error(`Invalid --fail-on value "${val}". Expected: mismatch | unused | any`);
        }
        args.failOn = val as 'mismatch' | 'unused' | 'any';
      } else if (arg === '--min-score') {
        const val = Number(argv[++i]);
        if (isNaN(val) || val < 0 || val > 100) {
          throw new Error(`Invalid --min-score value. Expected a number between 0 and 100`);
        }
        args.minScore = val;
      } else if (!arg.startsWith('-')) {
        args.manifestFiles.push(arg);
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
      case '--version':
      case '-v':
        args.command = 'version';
        break;
      case '--interactive':
      case '-i':
        args.interactive = true;
        break;
      case '--source':
      case '-s':
        args.sourceDirs.push(...(argv[++i] ?? '').split(',').filter(Boolean));
        break;
      case '--depth': {
        const val = argv[++i] ?? '';
        if (!VALID_DEPTHS.has(val)) {
          throw new Error(`Invalid --depth value "${val}". Expected: direct | local-graph`);
        }
        args.depth = val as 'direct' | 'local-graph';
        break;
      }
      case '--shared':
        args.sharedConfig = parseSharedValue(argv[++i] ?? '');
        break;
      case '--tsconfig':
        args.tsconfigPath = argv[++i];
        break;
      case '--workspace-packages':
        args.workspacePackages.push(...(argv[++i] ?? '').split(',').filter(Boolean));
        break;
      case '--fail-on': {
        const val = argv[++i] ?? '';
        if (!VALID_FAIL_ON.has(val)) {
          throw new Error(`Invalid --fail-on value "${val}". Expected: mismatch | unused | any`);
        }
        args.failOn = val as 'mismatch' | 'unused' | 'any';
        break;
      }
      case '--min-score': {
        const val = Number(argv[++i]);
        if (isNaN(val) || val < 0 || val > 100) {
          throw new Error(`Invalid --min-score value. Expected a number between 0 and 100`);
        }
        args.minScore = val;
        break;
      }
      case '--kind': {
        const val = argv[++i] ?? '';
        if (!VALID_KINDS.has(val)) {
          throw new Error(`Invalid --kind value "${val}". Expected: host | remote | unknown`);
        }
        args.kind = val as 'host' | 'remote' | 'unknown';
        break;
      }
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

  if (!args.interactive && args.sourceDirs.length === 0) {
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
