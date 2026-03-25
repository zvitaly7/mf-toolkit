import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

export async function scanFiles(
  dirs: string[],
  extensions: string[] = DEFAULT_EXTENSIONS,
): Promise<string[]> {
  const files: string[] = [];

  for (const dir of dirs) {
    try {
      const entries = await readdir(dir, { recursive: true });

      for (const entry of entries) {
        if (typeof entry === 'string' && extensions.includes(extname(entry))) {
          files.push(join(dir, entry));
        }
      }
    } catch {
      // Directory doesn't exist — skip silently
    }
  }

  return files;
}
