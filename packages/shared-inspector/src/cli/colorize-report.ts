// ─── Report colorizer ─────────────────────────────────────────────────────────
//
// Post-processes the plain-text output of formatReport / formatFederationReport,
// adding ANSI colors line-by-line.
//
// Separated from the reporters so the library API stays color-free
// (useful for programmatic consumers, JSON pipelines, etc.)

import { isTTY, bold, dim, red, yellow, green, cyan, gray, combine } from './colors.js';

// ─── Line matchers ────────────────────────────────────────────────────────────

function colorizeLine(line: string): string {
  // ── Issue titles ────────────────────────────────────────────────────────────
  if (/^⚠  Version (Mismatch|Conflict)/.test(line))  return combine(bold, red)(line);
  if (/^⚠  (Singleton Risk|Singleton Mismatch|Eager Risk)/.test(line)) return combine(bold, yellow)(line);
  if (/^→  (Not Shared|Host Gap)/.test(line))        return combine(bold, cyan)(line);
  if (/^✗  (Unused Shared|Ghost Share)/.test(line))  return dim(line);

  // ── Card detail lines ───────────────────────────────────────────────────────
  if (/→ Risk:/.test(line))                 return line.replace('→ Risk:', red('→ Risk:'));
  if (/💡 Fix:/.test(line))                 return green(line);
  if (/Remove ".+" from/.test(line))        return green(line);

  // ── Score block ─────────────────────────────────────────────────────────────
  if (/^Score:\s+\d+\/100/.test(line)) {
    if (line.includes('CRITICAL')) return combine(bold, red)(line);
    if (line.includes('RISKY'))    return combine(bold, yellow)(line);
    if (line.includes('GOOD'))     return combine(bold, cyan)(line);
    if (line.includes('HEALTHY'))  return combine(bold, green)(line);
    return bold(line);
  }

  // ── Section markers ─────────────────────────────────────────────────────────
  if (/^\[MfSharedInspector\]/.test(line))   return bold(line);
  if (/^[─]{10,}/.test(line))                return gray(line);
  if (/^Total:/.test(line))                  return dim(line);
  if (/^Issues:/.test(line))                 return bold(line);

  // ── Score issue rows ─────────────────────────────────────────────────────────
  if (/🔴/.test(line))  return line;   // emoji already colored in supported terminals
  if (/🟠/.test(line))  return line;
  if (/🟡/.test(line))  return line;

  // ── Clean / no-issues ────────────────────────────────────────────────────────
  if (/✓\s+No issues/.test(line))  return combine(bold, green)(line);
  if (/✓\s+No federation/.test(line)) return combine(bold, green)(line);

  return line;
}

/**
 * Adds ANSI colors to a formatted report string.
 * Returns the original string unchanged when stdout is not a TTY.
 */
export function colorizeReport(text: string): string {
  if (!isTTY) return text;
  return text.split('\n').map(colorizeLine).join('\n');
}
