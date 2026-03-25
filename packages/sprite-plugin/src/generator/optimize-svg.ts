import { optimize } from 'svgo';

/** Literal color strings to replace with currentColor */
const COLOR_LITERALS = ['#000000', '#000', 'black'];

/** Regex patterns for CSS color functions (rgb/rgba with zero values) */
const COLOR_PATTERNS = [
  /rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/g,
  /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*1\s*\)/g,
];

/**
 * Optimizes an SVG string: removes metadata, minifies paths,
 * and replaces hardcoded colors with currentColor for theming support.
 *
 * Handles colors in both XML attributes and embedded <style> blocks:
 *   fill="#000"           → fill="currentColor"
 *   .cls{fill:#000000}   → .cls{fill:currentColor}
 *   fill="rgb(0,0,0)"    → fill="currentColor"
 */
export function optimizeSvg(raw: string, replaceColors = true): string {
  const result = optimize(raw, {
    multipass: true,
    plugins: [
      {
        name: 'preset-default' as const,
        params: {
          overrides: {
            removeViewBox: false,
          },
        },
      } as never,
      'removeDimensions',
      'removeXMLNS',
    ],
  });

  let svg = result.data;

  if (replaceColors) {
    for (const color of COLOR_LITERALS) {
      svg = svg.replaceAll(color, 'currentColor');
    }
    for (const pattern of COLOR_PATTERNS) {
      svg = svg.replace(pattern, 'currentColor');
    }
  }

  return svg;
}
