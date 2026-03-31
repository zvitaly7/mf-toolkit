import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CliArgs } from './types.js';
import type { SharedDepConfig } from '../types.js';

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
      case '--interactive':
      case '-i':
        args.interactive = true;
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
