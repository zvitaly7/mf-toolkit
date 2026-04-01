import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeFederation } from '../analyzer/analyze-federation.js';
import { formatFederationReport } from '../reporter/format-federation-report.js';
import { scoreFederationReport } from '../reporter/scoring.js';
import { createSpinner } from './spinner.js';
import { colorizeReport } from './colorize-report.js';
import type { FederationReport } from '../types.js';
import type { CliArgs } from './types.js';

function isUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://');
}

async function loadManifestContent(source: string): Promise<string> {
  if (isUrl(source)) {
    const res = await fetch(source);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return res.text();
  }
  return readFileSync(resolve(process.cwd(), source), 'utf-8');
}

export async function runFederation(
  args: CliArgs,
  write: (s: string) => void,
): Promise<number> {
  if (args.manifestFiles.length === 0) {
    write('Error: federation command requires at least one manifest file\n');
    write('Usage: mf-inspector federation <manifest1.json|url> [manifest2.json|url...]\n');
    return 1;
  }

  const spinner = createSpinner();
  spinner.start(`Loading ${args.manifestFiles.length} manifest${args.manifestFiles.length > 1 ? 's' : ''}`);

  const manifests = [];
  for (const source of args.manifestFiles) {
    let content: string;
    try {
      content = await loadManifestContent(source);
    } catch (err) {
      spinner.stop();
      const reason = err instanceof Error ? err.message : String(err);
      if (isUrl(source)) {
        write(`Error: cannot fetch "${source}": ${reason}\n`);
      } else {
        write(`Error: cannot read file "${source}"\n`);
      }
      return 1;
    }
    try {
      manifests.push(JSON.parse(content));
    } catch {
      spinner.stop();
      write(`Error: "${source}" is not valid JSON\n`);
      return 1;
    }
  }

  spinner.succeed(`Loaded ${manifests.length} manifest${manifests.length > 1 ? 's' : ''}`);

  const report = analyzeFederation(manifests);
  write(colorizeReport(formatFederationReport(report)));

  if (args.failOn && shouldFailFederation(report, args.failOn)) return 1;

  if (args.minScore !== undefined) {
    const { score } = scoreFederationReport(report);
    if (score < args.minScore) return 1;
  }

  return 0;
}

function shouldFailFederation(
  report: FederationReport,
  failOn: 'mismatch' | 'unused' | 'any',
): boolean {
  switch (failOn) {
    case 'mismatch': return report.versionConflicts.length > 0;
    case 'unused':   return report.ghostShares.length > 0;
    case 'any':      return (
      report.versionConflicts.length > 0 ||
      report.singletonMismatches.length > 0 ||
      report.hostGaps.length > 0 ||
      report.ghostShares.length > 0
    );
  }
}
