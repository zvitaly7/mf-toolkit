import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeFederation } from '../analyzer/analyze-federation.js';
import { formatFederationReport } from '../reporter/format-federation-report.js';
import type { CliArgs } from './types.js';

export async function runFederation(
  args: CliArgs,
  write: (s: string) => void,
): Promise<number> {
  if (args.manifestFiles.length === 0) {
    write('Error: federation command requires at least one manifest file\n');
    write('Usage: mf-inspector federation <manifest1.json> [manifest2.json...]\n');
    return 1;
  }

  const manifests = args.manifestFiles.map((file) => {
    const content = readFileSync(resolve(process.cwd(), file), 'utf-8');
    return JSON.parse(content);
  });

  const report = analyzeFederation(manifests);
  write(formatFederationReport(report));
  return 0;
}
