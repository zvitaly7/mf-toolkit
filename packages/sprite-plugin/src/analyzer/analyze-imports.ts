import type { AnalyzerOptions, IconUsage } from '../types.js';
import { scanFiles } from './scan-files.js';
import { resolveParser } from './resolve-parser.js';

/**
 * Analyzes source files to find all icon imports matching the given pattern.
 * Returns a deduplicated list of icon usages.
 */
export async function analyzeImports(options: AnalyzerOptions): Promise<IconUsage[]> {
  const parseFn = await resolveParser(options.parser);
  const files = await scanFiles(options.sourceDirs, options.extensions);

  const allUsages: IconUsage[] = [];

  for (const file of files) {
    const usages = await parseFn(file, options.importPattern, options.extractNamedImports ?? false);
    allUsages.push(...usages);
  }

  // Deduplicate by icon name, keep first occurrence
  const seen = new Set<string>();
  const unique: IconUsage[] = [];

  for (const usage of allUsages) {
    const normalizedName = usage.name.toLowerCase();
    if (!seen.has(normalizedName)) {
      seen.add(normalizedName);
      unique.push(usage);
    }
  }

  return unique;
}
