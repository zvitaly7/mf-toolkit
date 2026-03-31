import { parseArgs } from './args.js';
import { HELP } from './help.js';
import { runInteractive, makeReadlinePrompt } from './interactive.js';
import { runProject } from './run-project.js';
import { runFederation } from './run-federation.js';
import type { PromptFn } from './types.js';

export { parseArgs, parseSharedValue } from './args.js';
export { shouldFail } from './run-project.js';
export { runInteractive } from './interactive.js';
export { HELP } from './help.js';
export type { CliArgs, PromptFn } from './types.js';

export async function main(
  argv: string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
  prompt?: PromptFn,
): Promise<number> {
  let args = parseArgs(argv);

  if (args.command === 'help') {
    write(HELP);
    return 0;
  }

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
