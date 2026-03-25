import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/** Directories to always skip when scanning for source files */
const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage'];

export async function scanFiles(
  dirs: string[],
  extensions: string[] = DEFAULT_EXTENSIONS,
): Promise<string[]> {
  const files: string[] = [];

  for (const dir of dirs) {
    try {
      const entries = await readdir(dir, { recursive: true });

      for (const entry of entries) {
        if (typeof entry !== 'string') continue;
        if (!extensions.includes(extname(entry))) continue;
        if (isIgnoredPath(entry)) continue;

        files.push(join(dir, entry));
      }
    } catch {
      // Directory doesn't exist — skip silently
    }
  }

  return files;
}

function isIgnoredPath(filePath: string): boolean {
  const segments = filePath.split('/');
  return segments.some((segment) => IGNORED_DIRS.includes(segment));
}
