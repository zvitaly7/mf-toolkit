// ─── Shared config ───────────────────────────────────────────────────────────

export interface SharedDepConfig {
  singleton?: boolean;
  eager?: boolean;
  requiredVersion?: string;
}

// ─── Collector ───────────────────────────────────────────────────────────────

export interface PackageOccurrence {
  package: string;
  /**
   * Original module specifier as it appeared in source.
   * For deep imports this differs from `package`:
   *   specifier: 'lodash/cloneDeep' → package: 'lodash'.
   * Used to detect deep-import bypass of MF shared scope.
   */
  specifier: string;
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
  /**
   * Path to tsconfig.json for resolving TypeScript path aliases (e.g. '@app/*').
   * When provided, aliased imports are followed during local-graph traversal
   * just like relative imports — packages behind aliases become visible.
   * @default undefined (aliases not resolved)
   */
  tsconfigPath?: string;
  /**
   * Local workspace package names to treat as internal (not external packages).
   * Imports matching these names are excluded from resolvedPackages.
   * Supports exact names and '@scope/*' globs.
   * @example ['@my-org/design-system', '@my-org/*']
   */
  workspacePackages?: string[];
  /**
   * Parser strategy for import extraction.
   * @default 'regex'
   * @planned 'typescript' (AST-based) — not yet implemented; value is accepted but has no effect.
   */
  parser?: ParserStrategy;
}

// ─── ProjectManifest (schemaVersion: 2) ──────────────────────────────────────

export interface ProjectManifest {
  schemaVersion: 2;
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
      /**
       * Distinct subpath specifiers used in source for this package
       * (e.g. ['lodash/cloneDeep', 'lodash/debounce']).
       * Empty when all imports use the package root specifier.
       * Webpack/Rspack MF only matches shared by the declared key — deep
       * imports listed here bypass shared-scope negotiation at runtime.
       */
      deepImports: string[];
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
  /**
   * Deep-import specifiers to exclude from the deep-import bypass detector.
   * Use this when a project relies on subpaths handled by the JSX transform
   * or by an MF setup that explicitly shares specific subpaths.
   * @default ['react/jsx-runtime', 'react/jsx-dev-runtime']
   */
  deepImportAllowlist?: string[];
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

export interface EagerRiskEntry {
  /** Package declared with eager: true but without singleton: true.
   *  Eager-loading without singleton can cause duplicate module instances
   *  when multiple MFs load the same package before negotiation completes. */
  package: string;
}

export interface DeepImportBypassEntry {
  /** Shared package whose subpaths are imported directly */
  package: string;
  /**
   * Distinct subpath specifiers observed in source code
   * (e.g. ['lodash/cloneDeep', 'lodash/debounce']).
   * These bypass the MF shared scope: each MF bundles its own copy of the subpath
   * even when the root package is shared as singleton.
   */
  specifiers: string[];
  /** Number of unique files containing at least one deep import of this package */
  fileCount: number;
  /** Up to a few files where the deep imports occur (for the report) */
  files: string[];
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
  /** Packages declared with eager: true but without singleton: true */
  eagerRisks: EagerRiskEntry[];
  /**
   * Shared packages where source imports subpaths directly.
   * Webpack/Rspack MF only routes through shared scope when the import
   * specifier matches the declared shared key — subpaths bypass it,
   * making the shared declaration ineffective for those imports.
   */
  deepImportBypass: DeepImportBypassEntry[];
  summary: {
    totalShared: number;
    usedShared: number;
    unusedCount: number;
    candidatesCount: number;
    mismatchedCount: number;
    singletonRisksCount: number;
    eagerRisksCount: number;
    deepImportBypassCount: number;
  };
}

// ─── Federation analyzer (v0.2) ──────────────────────────────────────────────

export interface FederationAnalysisOptions {
  /**
   * Packages that are always expected to be shared across all MFs.
   * Used to strengthen ghost-sharing detection.
   * @default ['react', 'react-dom']
   */
  alwaysShared?: string[];
}

/**
 * Package shared by one MF but absent from shared config in all other MFs.
 * Creates one-sided coupling with no federation benefit.
 */
export interface GhostShareEntry {
  package: string;
  /** MF that declares this package in shared config */
  sharedBy: string;
  /** MFs that also use the package but don't declare it in shared */
  usedUnsharedBy: string[];
}

/**
 * Package used by one or more remotes but not declared in shared by any MF.
 * Each MF bundles its own copy — potential duplication.
 */
export interface HostGapEntry {
  package: string;
  /** MFs that use the package without any shared declaration */
  missingIn: string[];
}

/**
 * Package where different MFs declare incompatible requiredVersion ranges.
 * Module Federation singleton resolution will fail silently.
 */
export interface VersionConflictEntry {
  package: string;
  /** Map of MF name → requiredVersion declared in that MF's shared config */
  versions: Record<string, string>;
}

/**
 * Package where some MFs declare singleton: true and others don't.
 * Inconsistent singleton flags cause unpredictable MF negotiation.
 */
export interface SingletonMismatchEntry {
  package: string;
  /** MFs that declare singleton: true */
  singletonIn: string[];
  /** MFs that declare the package in shared but without singleton: true */
  nonSingletonIn: string[];
}

export interface FederationReport {
  /**
   * Packages in shared config of one MF that no other MF shares or uses.
   * Safe to remove from shared — only creates artificial coupling.
   */
  ghostShares: GhostShareEntry[];
  /**
   * Packages used across MFs but not declared in shared by anyone.
   * Each MF pays the full bundle cost independently.
   */
  hostGaps: HostGapEntry[];
  /**
   * Packages with conflicting requiredVersion across MFs.
   * MF singleton negotiation will pick one version and silently break others.
   */
  versionConflicts: VersionConflictEntry[];
  /**
   * Packages where singleton flag is inconsistent across MFs.
   * Risk of duplicate instances in production.
   */
  singletonMismatches: SingletonMismatchEntry[];
  summary: {
    totalManifests: number;
    ghostSharesCount: number;
    hostGapsCount: number;
    versionConflictsCount: number;
    singletonMismatchesCount: number;
  };
}

// ─── Webpack plugin ───────────────────────────────────────────────────────────

export interface WebpackPluginOptions extends Omit<CollectorOptions, 'name'> {
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
