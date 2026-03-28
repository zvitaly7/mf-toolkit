/**
 * @mf-toolkit/shared-inspector — demo
 *
 * Runs buildProjectManifest twice (direct + local-graph) on the mf-checkout
 * fixture, analyses both manifests, and shows the difference.
 *
 * Usage:
 *   npx tsx packages/shared-inspector/demo/run.ts
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProjectManifest } from '../src/collector/build-project-manifest.js';
import { analyzeProject } from '../src/analyzer/analyze-project.js';
import { formatReport } from '../src/reporter/format-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURE = join(__dirname, '../test/fixtures/mf-checkout');
const SOURCE_DIRS = [join(FIXTURE, 'src')];
const PKG_JSON = join(FIXTURE, 'package.json');

// Shared config that intentionally over-shares (lodash not used directly)
// and under-shares (mobx/mobx-react not declared)
const SHARED_CONFIG = {
  react:              { singleton: true, requiredVersion: '^19.0.0' },
  'react-dom':        { singleton: true, requiredVersion: '^19.0.0' },
  lodash:             {},                          // over-shared: not imported directly
  '@tanstack/react-query': { singleton: true },    // over-shared: not imported at all
  mobx:               { singleton: true },         // actually used — but via re-export
};

const COLLECTOR_OPTS = {
  name: 'mf-checkout',
  sourceDirs: SOURCE_DIRS,
  packageJsonPath: PKG_JSON,
  sharedConfig: SHARED_CONFIG,
};

// ─────────────────────────────────────────────────────────────────────────────

console.log('═'.repeat(60));
console.log(' @mf-toolkit/shared-inspector — demo');
console.log('═'.repeat(60));
console.log();
console.log('Fixture: mf-checkout');
console.log('  src/app.tsx      → import { observer } from "./shared"');
console.log('  src/shared/index.ts → export { observer } from "mobx-react"');
console.log('                       export { makeAutoObservable } from "mobx"');
console.log();
console.log('Point: mobx/mobx-react are hidden behind a barrel re-export.');
console.log('direct mode cannot see them. local-graph can.');
console.log();

// ── Phase 1: direct mode ─────────────────────────────────────────────────────

console.log('─'.repeat(60));
console.log(' Step 1 — buildProjectManifest({ depth: "direct" })');
console.log('─'.repeat(60));

const directManifest = await buildProjectManifest({ ...COLLECTOR_OPTS, depth: 'direct' });
const directReport   = analyzeProject(directManifest, { alwaysShared: ['react', 'react-dom'] });

console.log(formatReport(directReport, {
  name: directManifest.project.name,
  depth: directManifest.source.depth,
  filesScanned: directManifest.source.filesScanned,
}));

console.log('  resolvedPackages:', directManifest.usage.resolvedPackages.join(', '));
console.log();

// ── Phase 2: local-graph mode ────────────────────────────────────────────────

console.log('─'.repeat(60));
console.log(' Step 2 — buildProjectManifest({ depth: "local-graph" })');
console.log('─'.repeat(60));

const graphManifest = await buildProjectManifest({ ...COLLECTOR_OPTS, depth: 'local-graph' });
const graphReport   = analyzeProject(graphManifest, { alwaysShared: ['react', 'react-dom'] });

console.log(formatReport(graphReport, {
  name: graphManifest.project.name,
  depth: graphManifest.source.depth,
  filesScanned: graphManifest.source.filesScanned,
}));

console.log('  resolvedPackages:', graphManifest.usage.resolvedPackages.join(', '));
console.log();

// ── Diff ─────────────────────────────────────────────────────────────────────

console.log('─'.repeat(60));
console.log(' Difference: what local-graph found that direct missed');
console.log('─'.repeat(60));

const directSet = new Set(directManifest.usage.resolvedPackages);
const foundByGraph = graphManifest.usage.resolvedPackages.filter((p) => !directSet.has(p));

if (foundByGraph.length === 0) {
  console.log('  (no difference)');
} else {
  for (const pkg of foundByGraph) {
    const detail = graphManifest.usage.packageDetails.find((d) => d.package === pkg);
    const via = detail?.via === 'reexport'
      ? ` — re-exported from ${detail.files[0]}`
      : '';
    console.log(`  + ${pkg}${via}`);
  }
}

console.log();
console.log('═'.repeat(60));
