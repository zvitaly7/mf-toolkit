import type { ProjectReport } from '../types.js';
import { getDiagnostic, buildFixSnippet } from './diagnostics.js';

export interface FormatReportContext {
  name?: string;
  depth?: 'direct' | 'local-graph';
  filesScanned?: number;
}

const HR = '─'.repeat(60);

/**
 * Formats a ProjectReport as actionable diagnostic cards.
 *
 * Each finding is rendered as a card with:
 *   - Issue title + package name
 *   - Concrete detail (version numbers, import count, etc.)
 *   - Risk description (what breaks at runtime)
 *   - Ready-to-paste fix snippet
 *
 * Section order (by severity):
 *   1. Version mismatch  — most dangerous, sharing silently broken
 *   2. Unused shared     — easy wins, safe to remove
 *   3. Candidates        — not shared but should be
 *   4. Singleton risks   — missing singleton: true
 *   5. Eager risks       — eager without singleton
 *   6. Summary line
 */
export function formatReport(report: ProjectReport, ctx?: FormatReportContext): string {
  const lines: string[] = [];
  const { unused, candidates, mismatched, singletonRisks, eagerRisks, summary } = report;

  lines.push('', buildHeader(ctx), HR, '');

  const hasFindings =
    mismatched.length > 0 ||
    unused.length > 0 ||
    candidates.length > 0 ||
    singletonRisks.length > 0 ||
    eagerRisks.length > 0;

  if (!hasFindings) {
    lines.push('  ✓  No issues found. Shared config looks good.');
    lines.push('');
  }

  // ── 1. Version mismatch ────────────────────────────────────────────────────
  for (const m of mismatched) {
    const { risk } = getDiagnostic(m.package, 'mismatch');
    lines.push(`⚠  Version Mismatch — ${m.package}`);
    lines.push(`   configured: ${m.configured} | installed: ${m.installed}`);
    lines.push(`   → Risk: ${risk}`);
    lines.push(`   💡 Fix:`);
    for (const l of buildFixSnippet(m.package, { singleton: true, requiredVersion: m.configured }).split('\n')) {
      lines.push(`   ${l}`);
    }
    lines.push('');
  }

  // ── 2. Unused shared ──────────────────────────────────────────────────────
  for (const u of unused) {
    const { risk } = getDiagnostic(u.package, 'unused');
    const note = u.singleton ? 'shared as singleton' : 'shared without singleton';
    lines.push(`✗  Unused Shared — ${u.package}`);
    lines.push(`   0 imports, ${note}`);
    lines.push(`   → ${risk}`);
    lines.push(`   💡 Fix: Remove "${u.package}" from shared config`);
    lines.push('');
  }

  // ── 3. Candidates ─────────────────────────────────────────────────────────
  for (const c of candidates) {
    const { risk } = getDiagnostic(c.package, 'candidate');
    const fileCount = c.files.length;
    const filesLabel = fileCount === 1 ? '1 file' : `${fileCount} files`;
    const viaLabel = c.via === 'reexport' ? ` via re-export in ${c.files[0]}` : '';
    lines.push(`→  Not Shared — ${c.package} (${c.importCount} imports in ${filesLabel}${viaLabel})`);
    lines.push(`   → Risk: ${risk}`);
    lines.push(`   💡 Fix:`);
    for (const l of buildFixSnippet(c.package, { singleton: true }).split('\n')) {
      lines.push(`   ${l}`);
    }
    lines.push('');
  }

  // ── 4. Singleton risks ────────────────────────────────────────────────────
  for (const r of singletonRisks) {
    const { risk } = getDiagnostic(r.package, 'singleton-risk');
    lines.push(`⚠  Singleton Risk — ${r.package}`);
    lines.push(`   singleton: true is missing`);
    lines.push(`   → Risk: ${risk}`);
    lines.push(`   💡 Fix:`);
    for (const l of buildFixSnippet(r.package, { singleton: true }).split('\n')) {
      lines.push(`   ${l}`);
    }
    lines.push('');
  }

  // ── 5. Eager risks ────────────────────────────────────────────────────────
  for (const r of eagerRisks) {
    const { risk } = getDiagnostic(r.package, 'eager-risk');
    lines.push(`⚠  Eager Risk — ${r.package}`);
    lines.push(`   eager: true without singleton: true`);
    lines.push(`   → Risk: ${risk}`);
    lines.push(`   💡 Fix:`);
    for (const l of buildFixSnippet(r.package, { singleton: true, eager: true }).split('\n')) {
      lines.push(`   ${l}`);
    }
    lines.push('');
  }

  // ── 6. Summary ────────────────────────────────────────────────────────────
  lines.push(HR);
  lines.push(
    `Total: ${summary.totalShared} shared, ${summary.usedShared} used, ` +
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
