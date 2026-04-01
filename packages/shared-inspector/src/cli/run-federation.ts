import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeFederation } from '../analyzer/analyze-federation.js';
import { formatFederationReport } from '../reporter/format-federation-report.js';
import { createSpinner } from './spinner.js';
import { colorizeReport } from './colorize-report.js';
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

  const spinner = createSpinner();
  spinner.start(`Loading ${args.manifestFiles.length} manifest${args.manifestFiles.length > 1 ? 's' : ''}`);

  const manifests = [];
  for (const file of args.manifestFiles) {
    const filePath = resolve(process.cwd(), file);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      spinner.stop();
      write(`Error: cannot read file "${file}"\n`);
      return 1;
    }
    try {
      manifests.push(JSON.parse(content));
    } catch {
      spinner.stop();
      write(`Error: "${file}" is not valid JSON\n`);
      return 1;
    }
  }

  spinner.succeed(`Loaded ${manifests.length} manifest${manifests.length > 1 ? 's' : ''}`);

  const report = analyzeFederation(manifests);
  write(colorizeReport(formatFederationReport(report)));
  return 0;
}
