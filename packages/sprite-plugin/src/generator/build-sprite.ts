import { readFile, readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { optimizeSvg, type SvgoOptions } from './optimize-svg.js';

interface SvgSymbol {
  id: string;
  content: string;
}

export interface IconSize {
  /** Byte size of the SVG file before optimization */
  originalBytes: number;
  /** Byte size of the <symbol> element after SVGO optimization */
  sizeBytes: number;
}

/**
 * Extracts the inner content and viewBox from an SVG string,
 * wrapping it as a <symbol> element.
 */
function svgToSymbol(id: string, svg: string): SvgSymbol {
  const viewBoxMatch = svg.match(/viewBox=["']([^"']+)["']/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24';

  // Extract content between <svg> and </svg>
  let inner = svg
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .trim();

  // Prefix internal IDs to prevent collisions between icons
  // e.g., two icons both using id="gradient1" would conflict in the same sprite
  const safePrefix = id.replace(/[^a-zA-Z0-9]/g, '_') + '--';
  inner = inner
    .replace(/\bid="([^"]+)"/g, `id="${safePrefix}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${safePrefix}$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${safePrefix}$1"`)
    .replace(/xlink:href="#([^"]+)"/g, `xlink:href="#${safePrefix}$1"`);

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
 * "Coupon2"      → "coupon-2"
 * "CartIcon2"    → "cart-icon-2"
 */
function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z])([0-9])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Generates candidate names for matching an icon name to a file.
 * Tries multiple conventions: exact, lowercase, kebab-case.
 * Supports prefixed names like "ui/ChevronRight".
 *
 * "ChevronRight"    → ["chevronright", "chevron-right"]
 * "ui/ChevronRight" → ["ui/chevronright", "ui/chevron-right"]
 * "cart"            → ["cart"]
 */
function nameCandidates(name: string): string[] {
  const slashIndex = name.lastIndexOf('/');

  if (slashIndex === -1) {
    // No prefix — flat matching
    const lower = name.toLowerCase();
    const kebab = toKebabCase(name);
    const candidates = [lower];
    if (kebab !== lower) candidates.push(kebab);
    return candidates;
  }

  // Has prefix (e.g., "ui/ChevronRight") — preserve prefix for path matching
  const prefix = name.substring(0, slashIndex).toLowerCase();
  const iconName = name.substring(slashIndex + 1);
  const lower = iconName.toLowerCase();
  const kebab = toKebabCase(iconName);

  const candidates = [`${prefix}/${lower}`];
  if (kebab !== lower) candidates.push(`${prefix}/${kebab}`);
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
  svgoOptions?: SvgoOptions,
): Promise<{ svg: string; included: string[]; missing: string[]; sizes: Map<string, IconSize> }> {
  // Deduplicate requested names
  const requestedNames = [...new Set(iconNames)];
  const included: string[] = [];
  const missing: string[] = [];
  const sizes = new Map<string, IconSize>();

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
  // Entries are indexed by both basename and relative path (with subdirectory)
  // e.g., "ui/chevron-right.svg" creates:
  //   "chevron-right" → full path  (basename, last one wins if duplicates)
  //   "ui/chevron-right" → full path  (with subdirectory, always unique)
  const fileMap = new Map<string, string>();
  for (const file of allFiles) {
    const fullPath = join(iconsDir, file);
    const id = fileNameToId(file);

    // Relative path with subdirectory (e.g., "ui/chevron-right")
    const relativeId = file
      .replace(/\\/g, '/')
      .replace(extname(file), '')
      .toLowerCase();

    if (relativeId !== id) {
      fileMap.set(relativeId, fullPath);
    }

    if (verbose && fileMap.has(id) && fileMap.get(id) !== fullPath) {
      console.warn(`[sprite] Duplicate icon name "${id}": use path prefix to disambiguate (e.g., "ui/${id}")`);
    }
    fileMap.set(id, fullPath);
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
    const originalBytes = Buffer.byteLength(raw, 'utf-8');
    const optimized = optimizeSvg(raw, true, svgoOptions);
    const symbol = svgToSymbol(matchedId, optimized);
    symbols.push(symbol);
    included.push(matchedId);
    sizes.set(matchedId, {
      originalBytes,
      sizeBytes: Buffer.byteLength(symbol.content, 'utf-8'),
    });
  }

  if (verbose) {
    console.log(`[sprite] ${included.length} icons included, ${missing.length} missing`);
  }

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">',
    ...symbols.map((s) => s.content),
    '</svg>',
  ].join('\n');

  return { svg, included, missing, sizes };
}
