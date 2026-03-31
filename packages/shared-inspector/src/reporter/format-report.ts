import type { ProjectReport } from '../types.js';

export interface FormatReportContext {
  name?: string;
  depth?: 'direct' | 'local-graph';
  filesScanned?: number;
}

/**
 * Formats a ProjectReport as a human-readable terminal string.
 *
 * Section order (by severity / determinism):
 *   1. Version mismatch  — deterministic, most dangerous
 *   2. Unused shared     — deterministic, easy wins
 *   3. Candidates        — heuristic, actionable suggestions
 *   4. Singleton risks   — heuristic, potential runtime issues
 *   5. Summary line
 */
export function formatReport(report: ProjectReport, ctx?: FormatReportContext): string {
  const lines: string[] = [];
  const { unused, candidates, mismatched, singletonRisks, eagerRisks, summary } = report;

  // Header
  const header = buildHeader(ctx);
  lines.push('', header, '');

  const hasFindings =
    mismatched.length > 0 ||
    unused.length > 0 ||
    candidates.length > 0 ||
    singletonRisks.length > 0 ||
    eagerRisks.length > 0;

  if (!hasFindings) {
    lines.push('  No issues found. Shared config looks good.');
  }

  // ── 1. Version mismatch ────────────────────────────────────────────────────
  if (mismatched.length > 0) {
    lines.push('  Version mismatch (sharing silently broken):');
    for (const m of mismatched) {
      lines.push(`    ⚠ ${m.package} — requires ${m.configured}, installed ${m.installed}`);
    }
    lines.push('');
  }

  // ── 2. Unused shared ──────────────────────────────────────────────────────
  if (unused.length > 0) {
    lines.push('  Unused shared (safe to remove):');
    for (const u of unused) {
      const note = u.singleton ? 'shared as singleton' : 'shared without singleton';
      lines.push(`    ✗ ${u.package} — 0 imports, ${note}`);
    }
    lines.push('');
  }

  // ── 3. Candidates ─────────────────────────────────────────────────────────
  if (candidates.length > 0) {
    lines.push('  Candidates (consider adding to shared):');
    for (const c of candidates) {
      const fileCount = c.files.length;
      const filesLabel = fileCount === 1 ? '1 file' : `${fileCount} files`;
      const viaLabel = c.via === 'reexport' ? `, via re-export in ${c.files[0]}` : '';
      lines.push(`    → ${c.package} (${c.importCount} imports in ${filesLabel}${viaLabel})`);
    }
    lines.push('');
  }

  // ── 4. Singleton risks ────────────────────────────────────────────────────
  if (singletonRisks.length > 0) {
    lines.push('  Singleton risks (add singleton: true):');
    for (const r of singletonRisks) {
      lines.push(`    ⚠ ${r.package} — manages global state, singleton: true recommended`);
    }
    lines.push('');
  }

  // ── 5. Eager risks ────────────────────────────────────────────────────────
  if (eagerRisks.length > 0) {
    lines.push('  Eager risks (add singleton: true or remove eager: true):');
    for (const r of eagerRisks) {
      lines.push(`    ⚠ ${r.package} — eager: true without singleton: true, risk of duplicate instances`);
    }
    lines.push('');
  }

  // ── 6. Summary ────────────────────────────────────────────────────────────
  lines.push(
    `  Total: ${summary.totalShared} shared, ${summary.usedShared} used, ` +
    `${summary.unusedCount} unused, ${summary.candidatesCount} candidates, ` +
    `${summary.mismatchedCount} mismatch, ${summary.eagerRisksCount} eager risks`,
  );
  lines.push('');

  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildHeader(ctx?: FormatReportContext): string {
  const parts: string[] = [];
  if (ctx?.depth) parts.push(`depth: ${ctx.depth}`);
  if (ctx?.filesScanned !== undefined) parts.push(`${ctx.filesScanned} files scanned`);

  const meta = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  const name = ctx?.name ? ` ${ctx.name}` : '';

  return `[MfSharedInspector]${name}${meta}`;
}
