import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildProjectManifest } from '../collector/build-project-manifest.js';
import { analyzeProject } from '../analyzer/analyze-project.js';
import { formatReport } from '../reporter/format-report.js';
import { writeManifest } from '../reporter/write-report.js';
import { scoreProjectReport } from '../reporter/scoring.js';
import { createSpinner, createNullSpinner } from './spinner.js';
import { colorizeReport } from './colorize-report.js';
import type { ProjectReport } from '../types.js';
import type { CliArgs } from './types.js';

export function shouldFail(report: ProjectReport, failOn: 'mismatch' | 'unused' | 'any'): boolean {
  if (failOn === 'mismatch') return report.mismatched.length > 0;
  if (failOn === 'unused') return report.unused.length > 0;
  return (
    report.mismatched.length > 0 ||
    report.unused.length > 0 ||
    report.candidates.length > 0 ||
    report.singletonRisks.length > 0 ||
    report.eagerRisks.length > 0 ||
    report.deepImportBypass.length > 0
  );
}

export async function runProject(
  args: CliArgs,
  write: (s: string) => void,
): Promise<number> {
  let name = args.name;
  if (!name) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as { name?: string };
      name = pkg.name ?? 'project';
    } catch {
      name = 'project';
    }
  }

  const spinner = args.json ? createNullSpinner() : createSpinner();
  spinner.start(`Scanning ${args.sourceDirs.join(', ')}`);

  const manifest = await buildProjectManifest({
    name,
    sourceDirs: args.sourceDirs,
    depth: args.depth,
    sharedConfig: args.sharedConfig,
    tsconfigPath: args.tsconfigPath,
    workspacePackages: args.workspacePackages,
    kind: args.kind,
  });

  spinner.succeed(`Scanned ${manifest.source.filesScanned} files`);

  const report = analyzeProject(manifest);
  const score = scoreProjectReport(report);

  if (args.json) {
    write(JSON.stringify({ ...report, score }, null, 2) + '\n');
  } else {
    write(colorizeReport(formatReport(report, {
      name: manifest.project.name,
      depth: manifest.source.depth,
      filesScanned: manifest.source.filesScanned,
    })));
  }

  if (args.writeManifest) {
    const outPath = resolve(args.outputDir, 'project-manifest.json');
    await writeManifest(manifest, outPath);
    if (!args.json) write(`\n  Manifest written to ${outPath}\n`);
  }

  if (args.failOn && shouldFail(report, args.failOn)) return 1;

  if (args.minScore !== undefined && score.score < args.minScore) return 1;

  return 0;
}
