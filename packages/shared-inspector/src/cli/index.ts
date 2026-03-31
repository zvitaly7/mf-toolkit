import { readFileSync } from 'node:fs';
import { parseArgs } from './args.js';
import { HELP } from './help.js';
import { runInteractive, makeReadlinePrompt } from './interactive.js';
import { runProject } from './run-project.js';
import { runFederation } from './run-federation.js';
import { bold, cyan, gray, red, isTTY } from './colors.js';
import type { PromptFn } from './types.js';

export { parseArgs, parseSharedValue } from './args.js';
export { shouldFail } from './run-project.js';
export { runInteractive } from './interactive.js';
export { HELP } from './help.js';
export type { CliArgs, PromptFn } from './types.js';

function getVersion(): string {
  try {
    const pkgUrl = new URL('../../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf-8')) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

function printBanner(write: (s: string) => void, version: string): void {
  if (!isTTY) return;
  const v = gray(`v${version}`);
  write(`\n  ${bold(cyan('mf-inspector'))}  ${v}\n\n`);
}

export async function main(
  argv: string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
  prompt?: PromptFn,
): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    write(`${red('Error:')} ${(err as Error).message}\n`);
    return 1;
  }

  if (args.command === 'help') {
    write(HELP);
    return 0;
  }

  const version = getVersion();

  if (args.command === 'version') {
    write(`@mf-toolkit/shared-inspector ${version}\n`);
    return 0;
  }

  printBanner(write, version);

  if (args.command === 'federation') {
    return runFederation(args, write);
  }

  if (args.interactive) {
    let rl: { close: () => void } | undefined;
    if (!prompt) {
      const readline = await makeReadlinePrompt();
      prompt = readline.prompt;
      rl = readline;
    }
    args = await runInteractive(args, write, prompt);
    rl?.close();
  }

  return runProject(args, write);
}
