// ─── Shared config ───────────────────────────────────────────────────────────

export interface SharedDepConfig {
  singleton?: boolean;
  eager?: boolean;
  requiredVersion?: string;
}

// ─── Collector ───────────────────────────────────────────────────────────────

export interface PackageOccurrence {
  package: string;
  /** File where the package was observed */
  file: string;
  /** 'direct' = explicit import/require; 'reexport' = found via barrel re-export chain */
  via: 'direct' | 'reexport';
}

export type ParserStrategy = 'regex' | 'typescript';

export interface CollectorOptions {
  /** Project name (written into the manifest) */
  name: string;
  /** Directories to scan for source files */
  sourceDirs: string[];
  /**
   * Scan depth.
   * - 'direct': regex-scan imports/requires only (fast, shallow)
   * - 'local-graph': + recursive local module traversal to find packages behind barrel re-exports
   * @default 'local-graph'
   */
  depth?: 'direct' | 'local-graph';
  /** Shared config from Module Federation */
  sharedConfig?: Record<string, SharedDepConfig>;
  /** Project role. @default 'unknown' */
  kind?: 'host' | 'remote' | 'unknown';
  /** Path to package.json. @default './package.json' */
  packageJsonPath?: string;
  /** File extensions to scan. @default ['.ts', '.tsx', '.js', '.jsx'] */
  extensions?: string[];
  /** Packages to exclude from scan results (supports glob: '@company/*') */
  ignore?: string[];
  /** Parser strategy. @default 'regex' */
  parser?: ParserStrategy;
}

// ─── ProjectManifest (schemaVersion: 1) ──────────────────────────────────────

export interface ProjectManifest {
  schemaVersion: 1;
  generatedAt: string;

  project: {
    name: string;
    root: string;
    kind?: 'host' | 'remote' | 'unknown';
  };

  source: {
    /** Depth at which facts were collected — determines what is observable in this manifest */
    depth: 'direct' | 'local-graph';
    sourceDirs: string[];
    filesScanned: number;
  };

  usage: {
    /** Packages found via direct import/require declarations */
    directPackages: string[];
    /**
     * Full package list including packages reachable via local module chains.
     * Equals directPackages when depth === 'direct'.
     */
    resolvedPackages: string[];
    /**
     * Per-package details.
     * importCount = number of unique files from which the package is observed (= files.length).
     */
    packageDetails: Array<{
      package: string;
      importCount: number;
      files: string[];
      via: 'direct' | 'reexport';
    }>;
  };

  shared: {
    /** Normalised shared config from webpack/rspack */
    declared: Record<string, {
      singleton?: boolean;
      eager?: boolean;
      requiredVersion?: string;
    }>;
    source: 'explicit' | 'extracted-from-plugin';
  };

  versions: {
    /** From package.json dependencies + devDependencies */
    declared: Record<string, string>;
    /**
     * From node_modules/<pkg>/package.json.
     * Empty object when node_modules is not accessible — mismatch checks are skipped
     * for packages absent from this map.
     */
    installed: Record<string, string>;
  };
}

// ─── Analyzer ────────────────────────────────────────────────────────────────

export interface AnalysisOptions {
  /**
   * Packages that will never appear in the `unused` list.
   * Useful for packages consumed transitively (JSX Transform, UI-kit peer deps).
   * @default ['react', 'react-dom']
   */
  alwaysShared?: string[];
  /**
   * Additional packages to add to the built-in share-candidates list.
   */
  additionalCandidates?: string[];
  /**
   * Additional packages to add to the built-in singleton-risk list.
   */
  additionalSingletonRisks?: string[];
}

export interface UnusedEntry {
  package: string;
  singleton: boolean;
}

export interface CandidateEntry {
  package: string;
  importCount: number;
  files: string[];
  via: 'direct' | 'reexport';
}

export interface MismatchedEntry {
  package: string;
  configured: string;
  installed: string;
}

export interface SingletonRiskEntry {
  package: string;
}

export interface ProjectReport {
  /** Packages in shared config not observed in resolvedPackages */
  unused: UnusedEntry[];
  /** Observed packages not in shared config that are typically shared */
  candidates: CandidateEntry[];
  /** requiredVersion does not satisfy installed version */
  mismatched: MismatchedEntry[];
  /** Packages with global state shared without singleton: true */
  singletonRisks: SingletonRiskEntry[];
  summary: {
    totalShared: number;
    usedShared: number;
    unusedCount: number;
    candidatesCount: number;
    mismatchedCount: number;
    singletonRisksCount: number;
  };
}

// ─── Webpack plugin ───────────────────────────────────────────────────────────

export interface WebpackPluginOptions extends Omit<CollectorOptions, 'name' | 'sharedConfig'> {
  /** Policy options for the analyzer */
  analysis?: AnalysisOptions;
  /** Print warnings to console. @default true */
  warn?: boolean;
  /** Fail the build when these findings are present */
  failOn?: 'mismatch' | 'unused' | 'any';
  /** Write project-manifest.json to outputDir. @default false */
  writeManifest?: boolean;
  /** Output directory for manifest file. @default '.' */
  outputDir?: string;
}
