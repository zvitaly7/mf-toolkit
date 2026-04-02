import type { CliArgs, PromptFn } from './types.js';
import { parseSharedValue } from './args.js';

export async function runInteractive(
  args: CliArgs,
  write: (s: string) => void,
  prompt: PromptFn,
): Promise<CliArgs> {
  write('\n[MfSharedInspector] Interactive setup\n\n');

  const modeRaw = await prompt('Analyse single project or multiple microfrontends? (project / federation, default: project): ');
  const mode = modeRaw.trim().toLowerCase();

  if (mode === 'federation') {
    return runInteractiveFederation(args, write, prompt);
  }

  return runInteractiveProject(args, write, prompt);
}

async function runInteractiveProject(
  args: CliArgs,
  write: (s: string) => void,
  prompt: PromptFn,
): Promise<CliArgs> {
  const sourceDirsRaw = await prompt('Source directories to scan (default: ./src): ');
  args.sourceDirs = sourceDirsRaw.trim()
    ? sourceDirsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : ['./src'];

  const depthRaw = await prompt('Scan depth — direct or local-graph (default: local-graph): ');
  args.depth = depthRaw.trim() === 'direct' ? 'direct' : 'local-graph';

  const sharedRaw = await prompt('Shared packages — comma-separated names or path to .json (empty to skip): ');
  args.sharedConfig = sharedRaw.trim() ? parseSharedValue(sharedRaw.trim()) : undefined;

  const tsconfigRaw = await prompt('Path to tsconfig.json for alias resolution (empty to skip): ');
  args.tsconfigPath = tsconfigRaw.trim() || undefined;

  const wsRaw = await prompt('Workspace packages to exclude, comma-separated (empty to skip): ');
  args.workspacePackages = wsRaw.trim()
    ? wsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const kindRaw = await prompt('Project role — host / remote / unknown (default: unknown): ');
  const kindVal = kindRaw.trim().toLowerCase();
  args.kind = (['host', 'remote', 'unknown'] as const).includes(kindVal as never)
    ? (kindVal as 'host' | 'remote' | 'unknown')
    : undefined;

  const failOnRaw = await prompt('Fail build on findings — mismatch / unused / any / none (default: none): ');
  const failOnVal = failOnRaw.trim();
  args.failOn = (['mismatch', 'unused', 'any'] as const).includes(failOnVal as never)
    ? (failOnVal as 'mismatch' | 'unused' | 'any')
    : undefined;

  const minScoreRaw = await prompt('Minimum score threshold 0–100 (empty to skip): ');
  const minScoreVal = Number(minScoreRaw.trim());
  args.minScore = minScoreRaw.trim() && !isNaN(minScoreVal) ? minScoreVal : undefined;

  const jsonRaw = await prompt('Output as JSON? (y/N): ');
  args.json = jsonRaw.trim().toLowerCase() === 'y';

  const writeManifestRaw = await prompt('Write project-manifest.json for federation analysis? (y/N): ');
  args.writeManifest = writeManifestRaw.trim().toLowerCase() === 'y';

  if (args.writeManifest) {
    const outputDirRaw = await prompt('Output directory for manifest (default: .): ');
    args.outputDir = outputDirRaw.trim() || '.';
  }

  write('\n');
  return args;
}

async function runInteractiveFederation(
  args: CliArgs,
  write: (s: string) => void,
  prompt: PromptFn,
): Promise<CliArgs> {
  args.command = 'federation';

  const sourcesRaw = await prompt('Manifest files or URLs, space-separated: ');
  args.manifestFiles = sourcesRaw.trim().split(/\s+/).filter(Boolean);

  const failOnRaw = await prompt('Fail on findings — mismatch / unused / any / none (default: none): ');
  const failOnVal = failOnRaw.trim();
  args.failOn = (['mismatch', 'unused', 'any'] as const).includes(failOnVal as never)
    ? (failOnVal as 'mismatch' | 'unused' | 'any')
    : undefined;

  const minScoreRaw = await prompt('Minimum score threshold 0–100 (empty to skip): ');
  const minScoreVal = Number(minScoreRaw.trim());
  args.minScore = minScoreRaw.trim() && !isNaN(minScoreVal) ? minScoreVal : undefined;

  const jsonRaw = await prompt('Output as JSON? (y/N): ');
  args.json = jsonRaw.trim().toLowerCase() === 'y';

  write('\n');
  return args;
}

/** Creates a readline-based PromptFn using Node built-ins (no extra deps). */
export async function makeReadlinePrompt(): Promise<{ prompt: PromptFn; close: () => void }> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    prompt: (question: string) => rl.question(question),
    close: () => rl.close(),
  };
}
