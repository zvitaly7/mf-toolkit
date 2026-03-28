import type { CollectorOptions, AnalysisOptions, ProjectReport } from './types.js';
import { buildProjectManifest } from './collector/build-project-manifest.js';
import { analyzeProject } from './analyzer/analyze-project.js';

/**
 * Shortcut API — combines buildProjectManifest() + analyzeProject() in one call.
 *
 * Use this when you only need the report and don't need the intermediate manifest.
 * For CI pipelines or multi-project federation analysis, use the two-phase API
 * directly so you can persist and share the manifest.
 */
export async function inspect(
  options: CollectorOptions & { analysis?: AnalysisOptions },
): Promise<ProjectReport> {
  const { analysis, ...collectorOptions } = options;
  const manifest = await buildProjectManifest(collectorOptions);
  return analyzeProject(manifest, analysis);
}
