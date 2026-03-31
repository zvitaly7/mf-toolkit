// ─── ANSI color helpers ───────────────────────────────────────────────────────
//
// No external dependencies — plain escape codes.
// Auto-disabled when stdout is not a TTY or NO_COLOR env var is set.

export const isTTY: boolean =
  Boolean((process.stdout as NodeJS.WriteStream).isTTY) &&
  !process.env['NO_COLOR'] &&
  process.env['TERM'] !== 'dumb';

const ESC = '\x1b[';

function wrap(code: string, reset: string) {
  return (s: string) => (isTTY ? `${ESC}${code}m${s}${ESC}${reset}m` : s);
}

export const bold    = wrap('1',  '22');
export const dim     = wrap('2',  '22');
export const italic  = wrap('3',  '23');
export const red     = wrap('31', '39');
export const yellow  = wrap('33', '39');
export const green   = wrap('32', '39');
export const cyan    = wrap('36', '39');
export const blue    = wrap('34', '39');
export const magenta = wrap('35', '39');
export const gray    = wrap('90', '39');

/** Combine two color transforms. */
export function combine(...fns: Array<(s: string) => string>): (s: string) => string {
  return (s) => fns.reduce((acc, fn) => fn(acc), s);
}
