import type { CliArgs, PromptFn } from './types.js';
import { parseSharedValue } from './args.js';

export async function runInteractive(
  args: CliArgs,
  write: (s: string) => void,
  prompt: PromptFn,
): Promise<CliArgs> {
  write('\n[MfSharedInspector] Interactive setup\n\n');

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

  const failOnRaw = await prompt('Fail build on findings — mismatch / unused / any / none (default: none): ');
  const failOnVal = failOnRaw.trim();
  args.failOn = (['mismatch', 'unused', 'any'] as const).includes(failOnVal as never)
    ? (failOnVal as 'mismatch' | 'unused' | 'any')
    : undefined;

  const writeManifestRaw = await prompt('Write project-manifest.json? (y/N): ');
  args.writeManifest = writeManifestRaw.trim().toLowerCase() === 'y';

  if (args.writeManifest) {
    const outputDirRaw = await prompt('Output directory for manifest (default: .): ');
    args.outputDir = outputDirRaw.trim() || '.';
  }

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
