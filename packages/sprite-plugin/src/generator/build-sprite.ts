import { readFile, readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { optimizeSvg } from './optimize-svg.js';

interface SvgSymbol {
  id: string;
  content: string;
}

/**
 * Extracts the inner content and viewBox from an SVG string,
 * wrapping it as a <symbol> element.
 */
function svgToSymbol(id: string, svg: string): SvgSymbol {
  const viewBoxMatch = svg.match(/viewBox=["']([^"']+)["']/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24';

  // Extract content between <svg> and </svg>
  const inner = svg
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .trim();

  const content = `<symbol id="${id}" viewBox="${viewBox}">${inner}</symbol>`;
  return { id, content };
}

/**
 * Converts an icon file name to a symbol ID.
 * "chevron-right-16x16.svg" → "chevron-right-16x16"
 */
function fileNameToId(fileName: string): string {
  return basename(fileName, extname(fileName)).toLowerCase();
}

/**
 * Scans iconsDir for SVG files, filters to only the requested icon names,
 * optimizes each SVG, and assembles them into a sprite string.
 */
export async function buildSprite(
  iconsDir: string,
  iconNames: string[],
  verbose = false,
): Promise<{ svg: string; included: string[]; missing: string[] }> {
  const requestedSet = new Set(iconNames.map((n) => n.toLowerCase()));
  const included: string[] = [];
  const missing: string[] = [];

  // Read all SVG files from iconsDir
  let allFiles: string[];
  try {
    const entries = await readdir(iconsDir, { recursive: true });
    allFiles = entries
      .filter((e): e is string => typeof e === 'string' && e.endsWith('.svg'));
  } catch {
    throw new Error(`Icons directory not found: ${iconsDir}`);
  }

  // Build a map: normalized name → file path
  const fileMap = new Map<string, string>();
  for (const file of allFiles) {
    const id = fileNameToId(file);
    fileMap.set(id, join(iconsDir, file));
  }

  // Match requested icons to files
  const symbols: SvgSymbol[] = [];

  for (const name of requestedSet) {
    const filePath = fileMap.get(name);

    if (!filePath) {
      missing.push(name);
      if (verbose) {
        console.warn(`[sprite] Icon not found: "${name}"`);
      }
      continue;
    }

    const raw = await readFile(filePath, 'utf-8');
    const optimized = optimizeSvg(raw);
    symbols.push(svgToSymbol(name, optimized));
    included.push(name);
  }

  if (verbose) {
    console.log(`[sprite] ${included.length} icons included, ${missing.length} missing`);
  }

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">',
    ...symbols.map((s) => s.content),
    '</svg>',
  ].join('\n');

  return { svg, included, missing };
}
