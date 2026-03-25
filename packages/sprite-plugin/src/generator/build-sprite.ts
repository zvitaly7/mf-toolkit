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
 * Converts a PascalCase or camelCase name to kebab-case.
 * "ChevronRight" → "chevron-right"
 * "CartIcon2" → "cart-icon-2"
 */
function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Generates candidate names for matching an icon name to a file.
 * Tries multiple conventions: exact, lowercase, kebab-case.
 *
 * "ChevronRight" → ["chevronright", "chevron-right"]
 * "cart" → ["cart"]
 */
function nameCandidates(name: string): string[] {
  const lower = name.toLowerCase();
  const kebab = toKebabCase(name);
  const candidates = [lower];
  if (kebab !== lower) {
    candidates.push(kebab);
  }
  return candidates;
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
  // Deduplicate requested names
  const requestedNames = [...new Set(iconNames)];
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
  // If multiple files have the same basename, the last one wins
  const fileMap = new Map<string, string>();
  for (const file of allFiles) {
    const id = fileNameToId(file);
    if (verbose && fileMap.has(id)) {
      console.warn(`[sprite] Duplicate icon name "${id}": ${fileMap.get(id)} will be overwritten by ${join(iconsDir, file)}`);
    }
    fileMap.set(id, join(iconsDir, file));
  }

  // Match requested icons to files
  // Tries multiple name formats: lowercase, kebab-case (for PascalCase imports)
  const symbols: SvgSymbol[] = [];
  const seen = new Set<string>();

  for (const name of requestedNames) {
    const candidates = nameCandidates(name);
    let filePath: string | undefined;
    let matchedId: string | undefined;

    for (const candidate of candidates) {
      filePath = fileMap.get(candidate);
      if (filePath) {
        matchedId = candidate;
        break;
      }
    }

    if (!filePath || !matchedId) {
      missing.push(name);
      if (verbose) {
        console.warn(`[sprite] Icon not found: "${name}" (tried: ${candidates.join(', ')})`);
      }
      continue;
    }

    // Prevent duplicate symbols from different name forms
    if (seen.has(matchedId)) continue;
    seen.add(matchedId);

    const raw = await readFile(filePath, 'utf-8');
    const optimized = optimizeSvg(raw);
    symbols.push(svgToSymbol(matchedId, optimized));
    included.push(matchedId);
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
