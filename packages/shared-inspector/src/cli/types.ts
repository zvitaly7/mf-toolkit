import type { SharedDepConfig } from '../types.js';

export interface CliArgs {
  command: 'project' | 'federation' | 'help' | 'version';
  interactive: boolean;
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

export type PromptFn = (question: string) => Promise<string>;
