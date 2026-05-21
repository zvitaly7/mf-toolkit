import type { ProjectManifest } from '../types.js';
import { adaptMf2Manifest, isMf2Manifest } from './read-mf2-manifest.js';

/**
 * Normalises arbitrary JSON manifest input into the canonical ProjectManifest
 * shape consumed by analyzeProject/analyzeFederation.
 *
 * Accepts:
 *   - native shared-inspector ProjectManifest (schemaVersion: 2)
 *   - MF 2.0 mf-manifest.json emitted by @module-federation/enhanced
 *
 * Returns null for unsupported or malformed shapes.
 */
export function parseManifestInput(raw: unknown): ProjectManifest | null {
  if (isProjectManifest(raw)) return raw;

  if (isMf2Manifest(raw)) {
    try {
      return adaptMf2Manifest(raw);
    } catch {
      return null;
    }
  }

  return null;
}

function isProjectManifest(raw: unknown): raw is ProjectManifest {
  if (!raw || typeof raw !== 'object') return false;

  const manifest = raw as Partial<ProjectManifest>;

  return (
    manifest.schemaVersion === 2 &&
    typeof manifest.generatedAt === 'string' &&
    isProject(manifest.project) &&
    isSource(manifest.source) &&
    isUsage(manifest.usage) &&
    isShared(manifest.shared) &&
    isVersions(manifest.versions)
  );
}

function isProject(value: unknown): value is ProjectManifest['project'] {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<ProjectManifest['project']>;
  return (
    typeof project.name === 'string' &&
    typeof project.root === 'string' &&
    (project.kind === undefined ||
      project.kind === 'host' ||
      project.kind === 'remote' ||
      project.kind === 'unknown')
  );
}

function isSource(value: unknown): value is ProjectManifest['source'] {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<ProjectManifest['source']>;
  return (
    (source.depth === 'direct' || source.depth === 'local-graph') &&
    Array.isArray(source.sourceDirs) &&
    typeof source.filesScanned === 'number'
  );
}

function isUsage(value: unknown): value is ProjectManifest['usage'] {
  if (!value || typeof value !== 'object') return false;
  const usage = value as Partial<ProjectManifest['usage']>;
  return (
    Array.isArray(usage.directPackages) &&
    Array.isArray(usage.resolvedPackages) &&
    Array.isArray(usage.packageDetails)
  );
}

function isShared(value: unknown): value is ProjectManifest['shared'] {
  if (!value || typeof value !== 'object') return false;
  const shared = value as Partial<ProjectManifest['shared']>;
  return (
    shared.declared !== null &&
    typeof shared.declared === 'object' &&
    !Array.isArray(shared.declared) &&
    (shared.source === 'explicit' || shared.source === 'extracted-from-plugin')
  );
}

function isVersions(value: unknown): value is ProjectManifest['versions'] {
  if (!value || typeof value !== 'object') return false;
  const versions = value as Partial<ProjectManifest['versions']>;
  return (
    versions.declared !== null &&
    typeof versions.declared === 'object' &&
    !Array.isArray(versions.declared) &&
    versions.installed !== null &&
    typeof versions.installed === 'object' &&
    !Array.isArray(versions.installed)
  );
}
