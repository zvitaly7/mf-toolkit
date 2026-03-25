export interface SpritePluginOptions {
  /** Directory containing source SVG icons */
  iconsDir: string;

  /** Directories to scan for icon usage in source code */
  sourceDirs: string[];

  /**
   * Regex pattern to detect icon imports in source code.
   * Must contain a capture group for the icon name.
   *
   * @example
   * // Matches: import { Cart } from '@my-ui/icons/cart'
   * /from ['"]@my-ui\/icons\/(.+)['"]/
   */
  importPattern: RegExp;

  /** Output file path for the generated sprite */
  output: string;

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

export interface GeneratorOptions {
  /** Directory containing source SVG icons */
  iconsDir: string;

  /** Output file path for the generated sprite */
  output: string;

  /** List of icon names to include (from analyzer) */
  icons: string[];

  /** Log detailed information */
  verbose?: boolean;
}

export interface IconUsage {
  /** Detected icon name */
  name: string;

  /** File where the icon was imported */
  source: string;

  /** Line number of the import */
  line: number;
}
