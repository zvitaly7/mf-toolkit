export interface SpritePluginOptions {
  /** Directory containing source SVG icons */
  iconsDir: string;

  /** Directories to scan for icon usage in source code */
  sourceDirs: string[];

  /**
   * Regex pattern to match icon imports. Applied to the module specifier
   * (the string after `from` or inside `import()`).
   * Must contain a capture group for the icon name.
   *
   * @example
   * // Matches: import { Cart } from '@my-ui/icons/cart'
   * // The module specifier is '@my-ui/icons/cart'
   * /@my-ui\/icons\/(.+)/
   */
  importPattern: RegExp;

  /** Output file path for the generated sprite */
  output: string;

  /**
   * File extensions to scan for imports.
   * @default ['.ts', '.tsx', '.js', '.jsx']
   */
  extensions?: string[];

  /** Log detailed information during generation */
  verbose?: boolean;

  /** Skip generation if no icons are found */
  skipIfEmpty?: boolean;
}

export interface AnalyzerOptions {
  /** Directories to scan for icon usage */
  sourceDirs: string[];

  /** Regex pattern to detect icon imports */
  importPattern: RegExp;

  /** File extensions to scan */
  extensions?: string[];
}

export interface IconUsage {
  /** Detected icon name */
  name: string;

  /** File where the icon was imported */
  source: string;

  /** Line number of the import */
  line: number;
}
