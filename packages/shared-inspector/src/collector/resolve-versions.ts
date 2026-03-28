import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface ResolvedVersions {
  /** Versions from package.json dependencies + devDependencies */
  declared: Record<string, string>;
  /**
   * Versions from node_modules/<pkg>/package.json.
   * Empty object when node_modules is not accessible —
   * mismatch checks are skipped for packages absent from this map.
   */
  installed: Record<string, string>;
}

/**
 * Reads declared and installed versions for all packages listed in package.json.
 */
export async function resolveVersions(packageJsonPath: string): Promise<ResolvedVersions> {
  const declared = await readDeclaredVersions(packageJsonPath);
  const installed = await readInstalledVersions(packageJsonPath, Object.keys(declared));
  return { declared, installed };
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function readDeclaredVersions(packageJsonPath: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(packageJsonPath, 'utf-8');
  } catch {
    return {};
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }

  const deps = (pkg['dependencies'] ?? {}) as Record<string, string>;
  const devDeps = (pkg['devDependencies'] ?? {}) as Record<string, string>;

  return { ...deps, ...devDeps };
}

async function readInstalledVersions(
  packageJsonPath: string,
  packages: string[],
): Promise<Record<string, string>> {
  const nodeModulesDir = join(dirname(packageJsonPath), 'node_modules');
  const installed: Record<string, string> = {};

  await Promise.all(
    packages.map(async (pkg) => {
      try {
        const pkgJsonPath = join(nodeModulesDir, pkg, 'package.json');
        const raw = await readFile(pkgJsonPath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed['version'] === 'string') {
          installed[pkg] = parsed['version'];
        }
      } catch {
        // Package not found in node_modules — skip silently
      }
    }),
  );

  return installed;
}
