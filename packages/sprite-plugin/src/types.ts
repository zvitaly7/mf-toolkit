/**
 * Parser strategy for analyzing imports.
 * - 'regex' (default): zero-dependency regex-based parser
 * - 'typescript': uses TypeScript Compiler API (requires `typescript` installed)
 * - 'babel': uses @babel/parser (requires `@babel/parser` installed)
 */
export type ParserStrategy = 'regex' | 'typescript' | 'babel';

export type ParseFunction = (
  filePath: string,
  iconPattern: RegExp,
  extractNamedImports: boolean,
) => Promise<IconUsage[]>;

export interface SpritePluginOptions {
  /** Directory containing source SVG icons */
  iconsDir: string;

  /** Directories to scan for icon usage in source code */
  sourceDirs: string[];

  /**
   * Regex pattern to match icon imports. Applied to the module specifier
   * (the string after `from` or inside `import()`).
   *
   * In path mode (default): must contain a capture group for the icon name.
   * In named import mode (`extractNamedImports: true`): just needs to match
   * the module specifier, no capture group required.
   *
   * @example
   * // Path mode: import { X } from '@my-ui/icons/cart' → extracts "cart"
   * /@my-ui\/icons\/(.+)/
   *
   * // Named mode: import { Cart, Search } from '@ui/Icon/ui' → extracts "Cart", "Search"
   * /@ui\/Icon\/.+/
   */
  importPattern: RegExp;

  /** Output file path for the generated sprite */
  output: string;

  /**
   * When true, icon names are extracted from the named imports (`{ Cart, Search }`)
   * instead of from the module path. Use this when icons are imported as named
   * exports from a shared module.
   *
   * @default false
   *
   * @example
   * // Source: import { ChevronRight, Cart } from '@ui/Icon/ui'
   * // Extracts: ["ChevronRight", "Cart"]
   * {
   *   importPattern: /@ui\/Icon\/.+/,
   *   extractNamedImports: true,
   * }
   */
  extractNamedImports?: boolean;

  /**
   * File extensions to scan for imports.
   * @default ['.ts', '.tsx', '.js', '.jsx']
   */
  extensions?: string[];

  /** Log detailed information during generation */
  verbose?: boolean;

  /** Skip generation if no icons are found */
  skipIfEmpty?: boolean;

  /**
   * Generate a sprite-manifest.json alongside the sprite file.
   * Useful for CI pipelines, debugging, and build reports.
   * @default false
   */
  manifest?: boolean;

  /**
   * Parser strategy for analyzing imports.
   * @default 'regex'
   */
  parser?: ParserStrategy;
}

export interface AnalyzerOptions {
  /** Directories to scan for icon usage */
  sourceDirs: string[];

  /** Regex pattern to detect icon imports */
  importPattern: RegExp;

  /** Extract icon names from named imports instead of module path */
  extractNamedImports?: boolean;

  /** File extensions to scan */
  extensions?: string[];

  /** Parser strategy for analyzing imports */
  parser?: ParserStrategy;
}

export interface IconUsage {
  /** Detected icon name */
  name: string;

  /** File where the icon was imported */
  source: string;

  /** Line number of the import */
  line: number;
}
