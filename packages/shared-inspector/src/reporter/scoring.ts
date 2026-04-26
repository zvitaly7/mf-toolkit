import type { ProjectReport, FederationReport } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskScore {
  /** 0–100. Higher is better. */
  score: number;
  /** Verbal label derived from score range. */
  label: 'HEALTHY' | 'GOOD' | 'RISKY' | 'CRITICAL';
  /** Count of high-severity findings (version mismatches). */
  high: number;
  /** Count of medium-severity findings (singleton gaps, duplicate libs). */
  medium: number;
  /** Count of low-severity findings (over-sharing). */
  low: number;
}

// ─── Severity mapping ─────────────────────────────────────────────────────────
//
// ProjectReport:
//   HIGH   — mismatched versions + deepImportBypass  (sharing silently broken, runtime crash / shared scope bypassed)
//   MEDIUM — singletonRisks + eagerRisks + candidates  (duplicate instances / bundles)
//   LOW    — unused                       (dead config, over-sharing)
//
// FederationReport:
//   HIGH   — versionConflicts            (cross-MF singleton negotiation fails)
//   MEDIUM — singletonMismatches + hostGaps (inconsistent setup / unbundled copies)
//   LOW    — ghostShares                 (one-sided dead coupling)

const PENALTY: Record<'high' | 'medium' | 'low', number> = {
  high:   20,
  medium:  8,
  low:     3,
};

// ─── Scorers ─────────────────────────────────────────────────────────────────

export function scoreProjectReport(report: ProjectReport): RiskScore {
  const high   = report.mismatched.length + report.deepImportBypass.length;
  const medium = report.singletonRisks.length + report.eagerRisks.length + report.candidates.length;
  const low    = report.unused.length;
  return buildScore(high, medium, low);
}

export function scoreFederationReport(report: FederationReport): RiskScore {
  const high   = report.versionConflicts.length;
  const medium = report.singletonMismatches.length + report.hostGaps.length;
  const low    = report.ghostShares.length;
  return buildScore(high, medium, low);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function buildScore(high: number, medium: number, low: number): RiskScore {
  const penalty = high * PENALTY.high + medium * PENALTY.medium + low * PENALTY.low;
  const score   = Math.max(0, 100 - penalty);
  return { score, label: scoreLabel(score), high, medium, low };
}

function scoreLabel(score: number): RiskScore['label'] {
  if (score >= 90) return 'HEALTHY';
  if (score >= 70) return 'GOOD';
  if (score >= 40) return 'RISKY';
  return 'CRITICAL';
}

// ─── Formatter helper ─────────────────────────────────────────────────────────

const LABEL_ICON: Record<RiskScore['label'], string> = {
  HEALTHY:  '✅',
  GOOD:     '🟡',
  RISKY:    '🟠',
  CRITICAL: '🔴',
};

/**
 * Renders the score block appended to reports.
 *
 * @example
 * Score: 62/100 🟠 RISKY
 *
 * Issues:
 *   🔴  1 high    — version mismatch
 *   🟠  2 medium  — singleton gaps, duplicate libs
 *   🟡  0 low     — over-sharing
 */
export function formatScoreBlock(
  score: RiskScore,
  highLabel: string,
  mediumLabel: string,
  lowLabel: string,
): string {
  const icon = LABEL_ICON[score.label];
  const lines: string[] = [];

  lines.push(`Score: ${score.score}/100  ${icon} ${score.label}`);
  lines.push('');
  lines.push('Issues:');
  lines.push(`  🔴  ${score.high} high    — ${highLabel}`);
  lines.push(`  🟠  ${score.medium} medium  — ${mediumLabel}`);
  lines.push(`  🟡  ${score.low} low     — ${lowLabel}`);

  return lines.join('\n');
}
