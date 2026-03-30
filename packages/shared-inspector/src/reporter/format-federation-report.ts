import type { FederationReport } from '../types.js';

/**
 * Formats a FederationReport as a human-readable terminal string.
 *
 * Section order (by severity):
 *   1. Version conflicts    — deterministic, most dangerous (silent broken singleton)
 *   2. Singleton mismatches — deterministic, runtime risk
 *   3. Host gaps            — heuristic, bundle duplication
 *   4. Ghost shares         — heuristic, dead coupling
 *   5. Summary line
 */
export function formatFederationReport(report: FederationReport): string {
  const lines: string[] = [];
  const { ghostShares, hostGaps, versionConflicts, singletonMismatches, summary } = report;

  // ── Header ─────────────────────────────────────────────────────────────────
  lines.push('', `[MfSharedInspector] federation analysis (${summary.totalManifests} MFs)`, '');

  const hasFindings =
    versionConflicts.length > 0 ||
    singletonMismatches.length > 0 ||
    hostGaps.length > 0 ||
    ghostShares.length > 0;

  if (!hasFindings) {
    lines.push('  No federation-level issues found.');
    lines.push('');
    lines.push(`  Total: ${summary.totalManifests} MFs analysed, everything looks consistent.`);
    lines.push('');
    return lines.join('\n');
  }

  // ── 1. Version conflicts ───────────────────────────────────────────────────
  if (versionConflicts.length > 0) {
    lines.push('  Version conflicts (singleton negotiation will fail):');
    for (const c of versionConflicts) {
      const versions = Object.entries(c.versions)
        .map(([mf, v]) => `${mf}: ${v}`)
        .join(', ');
      lines.push(`    ⚠ ${c.package} — ${versions}`);
    }
    lines.push('');
  }

  // ── 2. Singleton mismatches ────────────────────────────────────────────────
  if (singletonMismatches.length > 0) {
    lines.push('  Singleton mismatches (add singleton: true to all MFs):');
    for (const s of singletonMismatches) {
      lines.push(
        `    ⚠ ${s.package} — singleton in [${s.singletonIn.join(', ')}], not singleton in [${s.nonSingletonIn.join(', ')}]`,
      );
    }
    lines.push('');
  }

  // ── 3. Host gaps ───────────────────────────────────────────────────────────
  if (hostGaps.length > 0) {
    lines.push('  Host gaps (add to shared — each MF bundles its own copy):');
    for (const g of hostGaps) {
      lines.push(`    → ${g.package} — used by [${g.missingIn.join(', ')}], not in shared`);
    }
    lines.push('');
  }

  // ── 4. Ghost shares ────────────────────────────────────────────────────────
  if (ghostShares.length > 0) {
    lines.push('  Ghost shares (remove from shared — no other MF benefits):');
    for (const g of ghostShares) {
      if (g.usedUnsharedBy.length > 0) {
        lines.push(
          `    ✗ ${g.package} — shared only by ${g.sharedBy}, ` +
          `used unshared by [${g.usedUnsharedBy.join(', ')}]`,
        );
      } else {
        lines.push(`    ✗ ${g.package} — shared only by ${g.sharedBy}, unused by all other MFs`);
      }
    }
    lines.push('');
  }

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  lines.push(
    `  Total: ${summary.totalManifests} MFs, ` +
    `${summary.versionConflictsCount} version conflicts, ` +
    `${summary.singletonMismatchesCount} singleton mismatches, ` +
    `${summary.hostGapsCount} host gaps, ` +
    `${summary.ghostSharesCount} ghost shares`,
  );
  lines.push('');

  return lines.join('\n');
}
