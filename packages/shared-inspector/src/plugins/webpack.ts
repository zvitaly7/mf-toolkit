import { isAbsolute, join, basename } from 'node:path';
import type { WebpackPluginOptions } from '../types.js';
import { buildProjectManifest } from '../collector/build-project-manifest.js';
import { analyzeProject } from '../analyzer/analyze-project.js';
import { formatReport } from '../reporter/format-report.js';
import { writeManifest } from '../reporter/write-report.js';

// ─── Minimal webpack type interfaces ─────────────────────────────────────────
// Avoids a hard dependency on webpack — it is a peer dep.

interface WebpackCompilation {
  errors: Error[];
  warnings: Error[];
}

interface WebpackCompiler {
  context: string;
  options: {
    name?: string;
  };
  hooks: {
    afterCompile: {
      tapPromise(
        name: string,
        fn: (compilation: WebpackCompilation) => Promise<void>,
      ): void;
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────

const PLUGIN_NAME = 'MfSharedInspectorPlugin';

/**
 * Webpack plugin that analyses Module Federation shared dependencies after
 * each compilation and reports issues to the console and/or build output.
 *
 * In v0.1, `sharedConfig` must be provided explicitly. Auto-extraction from
 * ModuleFederationPlugin is planned for v0.1.1.
 *
 * @example
 * ```js
 * new MfSharedInspectorPlugin({
 *   sourceDirs: ['./src'],
 *   sharedConfig: { react: { singleton: true }, mobx: { singleton: true } },
 *   warn: true,
 *   writeManifest: true,
 * })
 * ```
 */
export class MfSharedInspectorPlugin {
  private options: WebpackPluginOptions;

  constructor(options: WebpackPluginOptions) {
    this.options = options;
  }

  apply(compiler: WebpackCompiler): void {
    compiler.hooks.afterCompile.tapPromise(
      PLUGIN_NAME,
      async (compilation: WebpackCompilation) => {
        const {
          sourceDirs,
          depth = 'local-graph',
          sharedConfig,
          kind,
          packageJsonPath,
          extensions,
          ignore,
          tsconfigPath,
          workspacePackages,
          parser,
          analysis,
          warn = true,
          failOn,
          writeManifest: shouldWriteManifest = false,
          outputDir = '.',
        } = this.options;

        // Resolve name from webpack compiler, fallback to context dir name
        const name = compiler.options.name ?? basename(compiler.context);

        // Resolve paths relative to compiler.context when not absolute
        const resolvedPkgJson = packageJsonPath
          ? (isAbsolute(packageJsonPath) ? packageJsonPath : join(compiler.context, packageJsonPath))
          : join(compiler.context, 'package.json');

        const resolvedSourceDirs = sourceDirs.map((dir) =>
          isAbsolute(dir) ? dir : join(compiler.context, dir),
        );

        const resolvedOutputDir = isAbsolute(outputDir)
          ? outputDir
          : join(compiler.context, outputDir);

        try {
          const manifest = await buildProjectManifest({
            name,
            sourceDirs: resolvedSourceDirs,
            depth,
            sharedConfig,
            kind,
            packageJsonPath: resolvedPkgJson,
            extensions,
            ignore,
            tsconfigPath,
            workspacePackages,
            parser,
          });

          const report = analyzeProject(manifest, analysis);

          const hasFindings =
            report.mismatched.length > 0 ||
            report.unused.length > 0 ||
            report.candidates.length > 0 ||
            report.singletonRisks.length > 0 ||
            report.eagerRisks.length > 0;

          if (warn && hasFindings) {
            console.warn(
              formatReport(report, {
                name: manifest.project.name,
                depth: manifest.source.depth,
                filesScanned: manifest.source.filesScanned,
              }),
            );
          }

          if (shouldWriteManifest) {
            await writeManifest(manifest, join(resolvedOutputDir, 'project-manifest.json'));
          }

          if (failOn && shouldFailBuild(failOn, report)) {
            const msg =
              `[${PLUGIN_NAME}] Build failed (failOn: "${failOn}"): ` +
              `${report.mismatched.length} mismatch, ${report.unused.length} unused, ` +
              `${report.candidates.length} candidates, ${report.singletonRisks.length} singleton risks.`;
            compilation.errors.push(new Error(msg));
          }
        } catch (err) {
          // Analysis errors are non-fatal — warn but don't break the build
          compilation.warnings.push(
            new Error(
              `[${PLUGIN_NAME}] Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        }
      },
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shouldFailBuild(
  failOn: 'mismatch' | 'unused' | 'any',
  report: { mismatched: unknown[]; unused: unknown[]; candidates: unknown[]; singletonRisks: unknown[]; eagerRisks: unknown[] },
): boolean {
  switch (failOn) {
    case 'mismatch': return report.mismatched.length > 0;
    case 'unused':   return report.unused.length > 0;
    case 'any':      return (
      report.mismatched.length > 0 ||
      report.unused.length > 0 ||
      report.candidates.length > 0 ||
      report.singletonRisks.length > 0 ||
      report.eagerRisks.length > 0
    );
  }
}
