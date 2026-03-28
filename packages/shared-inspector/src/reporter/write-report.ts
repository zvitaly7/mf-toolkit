import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ProjectReport, ProjectManifest } from '../types.js';

/**
 * Serialises a ProjectReport to a JSON file.
 * Creates parent directories if they don't exist.
 */
export async function writeReport(report: ProjectReport, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
}

/**
 * Serialises a ProjectManifest to a JSON file.
 * Creates parent directories if they don't exist.
 */
export async function writeManifest(manifest: ProjectManifest, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(manifest, null, 2), 'utf-8');
}
