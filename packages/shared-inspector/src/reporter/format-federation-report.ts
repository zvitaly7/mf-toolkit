import type { FederationReport, VersionConflictEntry } from '../types.js';
import { getDiagnostic, buildFixSnippet } from './diagnostics.js';
import { scoreFederationReport, formatScoreBlock } from './scoring.js';

const HR = '─'.repeat(60);

/**
 * Formats a FederationReport as actionable diagnostic cards.
 *
 * Each finding shows:
 *   - Issue title + package name
 *   - Which MFs are involved
 *   - Risk description (what breaks at runtime)
 *   - Ready-to-paste fix snippet
 *
 * Section order (by severity):
 *   1. Version conflicts    — most dangerous, singleton negotiation fails silently
 *   2. Singleton mismatches — runtime risk, unpredictable instance selection
 *   3. Host gaps            — bundle duplication, no shared state
 *   4. Ghost shares         — dead coupling, safe to remove
 *   5. Summary line
 */
export function formatFederationReport(report: FederationReport): string {
  const lines: string[] = [];
  const { ghostShares, hostGaps, versionConflicts, singletonMismatches, summary } = report;

  lines.push('', `[MfSharedInspector] federation analysis (${summary.totalManifests} MFs)`, HR, '');

  const hasFindings =
    versionConflicts.length > 0 ||
    singletonMismatches.length > 0 ||
    hostGaps.length > 0 ||
    ghostShares.length > 0;

  if (!hasFindings) {
    lines.push('  ✓  No federation-level issues found. Everything looks consistent.');
    lines.push('');
    lines.push(HR);
    lines.push(formatScoreBlock(scoreFederationReport(report), 'version conflicts', 'singleton mismatches, host gaps', 'ghost shares'));
    lines.push('');
    lines.push(`Total: ${summary.totalManifests} MFs analysed, 0 issues.`);
    lines.push('');
    return lines.join('\n');
  }

  // ── 1. Version conflicts ───────────────────────────────────────────────────
  for (const c of versionConflicts) {
    const { risk } = getDiagnostic(c.package, 'mismatch');
    lines.push(`⚠  Version Conflict — ${c.package}`);
    for (const [mf, v] of Object.entries(c.versions)) {
      lines.push(`   ${mf}: ${v}`);
    }
    lines.push(`   → Risk: MF singleton negotiation will silently load wrong version → ${risk}`);
    lines.push(`   💡 Fix: Align requiredVersion across all MFs:`);
    const best = pickHighestRequiredVersion(c);
    for (const l of buildFixSnippet(c.package, { singleton: true, requiredVersion: best }).split('\n')) {
      lines.push(`   ${l}`);
    }
    lines.push('');
  }

  // ── 2. Singleton mismatches ────────────────────────────────────────────────
  for (const s of singletonMismatches) {
    const { risk } = getDiagnostic(s.package, 'singleton-risk');
    lines.push(`⚠  Singleton Mismatch — ${s.package}`);
    lines.push(`   singleton in: [${s.singletonIn.join(', ')}]`);
    lines.push(`   not singleton in: [${s.nonSingletonIn.join(', ')}]`);
    lines.push(`   → Risk: ${risk}`);
    lines.push(`   💡 Fix: Add singleton: true to all MFs that share ${s.package}`);
    lines.push('');
  }

  // ── 3. Host gaps ───────────────────────────────────────────────────────────
  for (const g of hostGaps) {
    const { risk } = getDiagnostic(g.package, 'candidate');
    lines.push(`→  Host Gap — ${g.package}`);
    lines.push(`   used by: [${g.missingIn.join(', ')}], not in shared config`);
    lines.push(`   → Risk: ${risk}`);
    lines.push(`   💡 Fix:`);
    for (const l of buildFixSnippet(g.package, { singleton: true }).split('\n')) {
      lines.push(`   ${l}`);
    }
    lines.push('');
  }

  // ── 4. Ghost shares ────────────────────────────────────────────────────────
  for (const g of ghostShares) {
    lines.push(`✗  Ghost Share — ${g.package}`);
    lines.push(`   shared only by: ${g.sharedBy}`);
    if (g.usedUnsharedBy.length > 0) {
      lines.push(`   used unshared by: [${g.usedUnsharedBy.join(', ')}]`);
    } else {
      lines.push(`   unused by all other MFs`);
    }
    lines.push(`   → One-sided coupling with no federation benefit`);
    lines.push(`   💡 Fix: Remove "${g.package}" from ${g.sharedBy}'s shared config`);
    lines.push('');
  }

  // ── 5. Score + Summary ───────────────────────────────────────────────────
  const score = scoreFederationReport(report);
  lines.push(HR);
  lines.push(formatScoreBlock(
    score,
    'version conflicts',
    'singleton mismatches, host gaps',
    'ghost shares',
  ));
  lines.push('');
  lines.push(
    `Total: ${summary.totalManifests} MFs, ` +
    `${summary.versionConflictsCount} version conflicts, ` +
    `${summary.singletonMismatchesCount} singleton mismatches, ` +
    `${summary.hostGapsCount} host gaps, ` +
    `${summary.ghostSharesCount} ghost shares`,
  );
  lines.push('');

  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pick the version string with the highest semver major (and minor) as the suggested fix. */
function pickHighestRequiredVersion(c: VersionConflictEntry): string {
  const versions = Object.values(c.versions);
  const sorted = versions.slice().sort((a, b) => {
    const clean = (v: string) => v.replace(/^[\^~>=<\s]+/, '').split('.').map(Number);
    const [aMaj = 0, aMin = 0, aPatch = 0] = clean(a);
    const [bMaj = 0, bMin = 0, bPatch = 0] = clean(b);
    if (bMaj !== aMaj) return bMaj - aMaj;
    if (bMin !== aMin) return bMin - aMin;
    return bPatch - aPatch;
  });
  return sorted[0];
}
