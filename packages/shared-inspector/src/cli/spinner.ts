// ─── Terminal spinner ─────────────────────────────────────────────────────────
//
// Uses braille frames for TTY, plain text for non-TTY / CI environments.
// Does NOT use the injectable `write` — writes directly to process.stdout
// so it can overwrite lines in place without interfering with the report output.

import { isTTY, green, gray } from './colors.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export interface Spinner {
  /** Start animating with a label. */
  start(text: string): void;
  /** Stop animation and print a success line. */
  succeed(text: string): void;
  /** Stop animation silently (clears the line). */
  stop(): void;
}

export function createNullSpinner(): Spinner {
  return { start() {}, succeed() {}, stop() {} };
}

export function createSpinner(): Spinner {
  if (!isTTY) {
    // Non-TTY (CI, piped): emit plain text lines via stdout
    return {
      start(text) { process.stdout.write(`  ${text}...\n`); },
      succeed(text) { process.stdout.write(`  ✓ ${text}\n`); },
      stop() {},
    };
  }

  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  function clearLine() {
    process.stdout.write('\r\x1b[K'); // carriage return + erase to end of line
  }

  return {
    start(text) {
      process.stdout.write('\x1b[?25l'); // hide cursor
      timer = setInterval(() => {
        clearLine();
        process.stdout.write(gray(`${FRAMES[frame % FRAMES.length]}  ${text}`));
        frame++;
      }, INTERVAL_MS);
    },
    succeed(text) {
      clearInterval(timer);
      clearLine();
      process.stdout.write(`${green('✓')}  ${text}\n`);
      process.stdout.write('\x1b[?25h'); // show cursor
    },
    stop() {
      clearInterval(timer);
      clearLine();
      process.stdout.write('\x1b[?25h');
    },
  };
}
