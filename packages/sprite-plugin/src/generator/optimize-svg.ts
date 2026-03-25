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
 * Color replacement runs BEFORE SVGO optimization to prevent SVGO
 * from stripping default black fills that we want to convert.
 *
 * Handles colors in both XML attributes and embedded <style> blocks:
 *   fill="#000"           → fill="currentColor"
 *   .cls{fill:#000000}   → .cls{fill:currentColor}
 *   fill="rgb(0,0,0)"    → fill="currentColor"
 */
export function optimizeSvg(raw: string, replaceColors = true): string {
  // Replace colors BEFORE SVGO — otherwise SVGO removes default black
  // fills as redundant, and we lose the chance to set currentColor
  let svg = raw;

  if (replaceColors) {
    for (const color of COLOR_LITERALS) {
      svg = svg.replaceAll(color, 'currentColor');
    }
    for (const pattern of COLOR_PATTERNS) {
      svg = svg.replace(pattern, 'currentColor');
    }
  }

  const result = optimize(svg, {
    multipass: true,
    plugins: [
      'preset-default',
      'removeDimensions',
      'removeXMLNS',
    ],
  });

  return result.data;
}
