# `@mf-toolkit/shared-inspector`

[![npm version](https://img.shields.io/npm/v/@mf-toolkit/shared-inspector?color=CB3837&logo=npm)](https://www.npmjs.com/package/@mf-toolkit/shared-inspector)
[![license](https://img.shields.io/npm/l/@mf-toolkit/shared-inspector?color=blue)](https://github.com/zvitaly7/mf-toolkit/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@mf-toolkit/shared-inspector?color=339933&logo=node.js)](https://nodejs.org)

**Stop debugging Module Federation in production.**

`shared` config breaks in silence — wrong versions ship, 10× React ends up in the bundle, singleton chains collapse, and teams get paged for "Invalid hook call" on Friday night. `shared-inspector` catches these mistakes at build time. Every finding comes with a risk score and a ready-to-paste fix.

## The problem

Module Federation teams manually manage `shared` config and make three kinds of mistakes:

- **Over-sharing** — packages listed in `shared` that the microfrontend never imports. Creates artificial version coupling between independent teams.
- **Under-sharing** — packages used by both host and remote but missing from `shared`. Each microfrontend bundles its own copy (10× React = 10× 130 KB).
- **Version mismatch** — `requiredVersion` doesn't match the installed version. Module Federation silently falls back to a local bundle. For packages with global state (React, styled-components) this causes "Invalid hook call" in production.

Existing tools (webpack-bundle-analyzer, source-map-explorer) show *what ended up in the bundle*, not *why shared config is suboptimal*. Different questions.

## Installation

```bash
npm install --save-dev @mf-toolkit/shared-inspector
```

## CLI

The fastest way to get started — no config file, no webpack required:

```bash
# Analyse the current project (auto-reads name from package.json)
npx @mf-toolkit/shared-inspector

# Step-by-step interactive wizard — answers guide you through all options
npx @mf-toolkit/shared-inspector --interactive

# Pass options directly
npx @mf-toolkit/shared-inspector --source ./src --shared react,react-dom --fail-on mismatch

# Load shared config from a JSON file
npx @mf-toolkit/shared-inspector --shared ./shared-config.json --write-manifest

# Cross-MF federation analysis from saved manifests
npx @mf-toolkit/shared-inspector federation checkout.json catalog.json cart.json
```

### Interactive wizard

```
$ npx @mf-toolkit/shared-inspector --interactive

[MfSharedInspector] Interactive setup

Source directories to scan (default: ./src):
Scan depth — direct or local-graph (default: local-graph):
Shared packages — comma-separated names or path to .json (empty to skip): react,react-dom,mobx
Path to tsconfig.json for alias resolution (empty to skip):
Workspace packages to exclude, comma-separated (empty to skip):
Fail build on findings — mismatch / unused / any / none (default: none): mismatch
Write project-manifest.json? (y/N): n
```

### CLI reference

| Flag | Default | Description |
|------|---------|-------------|
| `--source, -s <dirs>` | `./src` | Source dirs to scan, comma-separated |
| `--depth <depth>` | `local-graph` | Scan depth: `direct` \| `local-graph` |
| `--shared <packages\|file>` | — | Comma-separated package names or path to `.json` config |
| `--tsconfig <path>` | — | tsconfig.json for path alias resolution |
| `--workspace-packages <pkgs>` | — | Comma-separated workspace packages to exclude |
| `--name <name>` | auto from `package.json` | Project name |
| `--fail-on <rule>` | — | Exit 1 when findings match: `mismatch` \| `unused` \| `any` |
| `--write-manifest` | `false` | Write `project-manifest.json` to output dir |
| `--output-dir <dir>` | `.` | Output directory for manifest |
| `--interactive, -i` | — | Launch step-by-step wizard |
| `--version, -v` | — | Print version and exit |
| `--help, -h` | — | Show help |

## Terminal output

Each finding is rendered as a diagnostic card: what's wrong, what breaks at runtime, and a ready-to-paste fix.

```
  mf-inspector  v0.4.0

✓  Scanned 47 files

[MfSharedInspector] checkout (depth: local-graph, 47 files scanned)
────────────────────────────────────────────────────────────

⚠  Version Mismatch — react
   configured: ^18.0.0 | installed: 17.0.2
   → Risk: Invalid hook call, broken context across MFs
   💡 Fix:
   shared: {
     react: { singleton: true, requiredVersion: "^18.0.0" }
   }

✗  Unused Shared — lodash
   0 imports, shared without singleton
   → Wastes bundle negotiation overhead with no benefit
   💡 Fix: Remove "lodash" from shared config

→  Not Shared — mobx (12 imports in 8 files via re-export in src/shared/index.ts)
   → Risk: Each MF gets its own MobX — observables and reactions won't sync between MFs
   💡 Fix:
   shared: {
     mobx: { singleton: true }
   }

────────────────────────────────────────────────────────────
Score: 62/100  🟠 RISKY

Issues:
  🔴  1 high    — version mismatch
  🟠  1 medium  — singleton gaps, duplicate libs
  🟡  1 low     — over-sharing

Total: 12 shared, 10 used, 1 unused, 1 candidates, 1 mismatch, 0 eager risks
```

Colors are auto-applied in TTY terminals and disabled in CI / piped output (`NO_COLOR` / `TERM=dumb` respected).

## Risk scoring

Every report ends with a score out of 100:

| Severity | Penalty | Covers |
|----------|---------|--------|
| 🔴 HIGH | −20 each | Version mismatches, cross-MF version conflicts |
| 🟠 MEDIUM | −8 each | Singleton risks, eager risks, duplicate libs, host gaps |
| 🟡 LOW | −3 each | Unused shared packages, ghost shares |

| Score | Label |
|-------|-------|
| 90–100 | ✅ HEALTHY |
| 70–89 | 🟡 GOOD |
| 40–69 | 🟠 RISKY |
| 0–39 | 🔴 CRITICAL |

Use `scoreProjectReport` / `scoreFederationReport` programmatically to integrate with dashboards or custom CI gates:

```typescript
import { analyzeProject, scoreProjectReport } from '@mf-toolkit/shared-inspector';

const report = analyzeProject(manifest);
const { score, label, high, medium, low } = scoreProjectReport(report);

if (score < 70) {
  console.error(`Shared config score: ${score}/100 (${label})`);
  process.exit(1);
}
```

## Quick start

### Programmatic API (two-phase)

```typescript
import { buildProjectManifest, analyzeProject, formatReport } from '@mf-toolkit/shared-inspector';

// Phase 1: collect facts
const manifest = await buildProjectManifest({
  name: 'checkout',
  sourceDirs: ['./src'],
  sharedConfig: {
    react: { singleton: true, requiredVersion: '^18.0.0' },
    'react-dom': { singleton: true, requiredVersion: '^18.0.0' },
    lodash: {},
  },
  // depth: 'local-graph'            ← default, follows barrel re-exports
  // tsconfigPath: './tsconfig.json' ← optional, resolves @alias/* imports
  // workspacePackages: ['@my-org/*'] ← optional, excludes local monorepo packages
});

// Phase 2: analyse facts
const report = analyzeProject(manifest);

console.log(report.mismatched);
// [{ package: 'react', configured: '^18.0.0', installed: '17.0.2' }]

console.log(report.candidates);
// [{ package: 'mobx', importCount: 12, via: 'reexport', files: ['src/shared/index.ts'] }]

console.log(report.unused);
// [{ package: 'lodash', singleton: false }]

// Human-readable output with risk descriptions and fix snippets
console.log(formatReport(report, { name: manifest.project.name }));
```

### Shortcut API

```typescript
import { inspect } from '@mf-toolkit/shared-inspector';

const report = await inspect({
  name: 'checkout',
  sourceDirs: ['./src'],
  sharedConfig: { /* ... */ },
});
```

### Webpack plugin

`sharedConfig` is optional — the plugin auto-extracts it from `ModuleFederationPlugin` when not provided:

```typescript
import { MfSharedInspectorPlugin } from '@mf-toolkit/shared-inspector/webpack';

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'checkout',
      shared: { react: { singleton: true }, mobx: { singleton: true } },
    }),

    // sharedConfig not needed — auto-extracted from ModuleFederationPlugin above
    new MfSharedInspectorPlugin({
      sourceDirs: ['./src'],
      warn: true,
      writeManifest: true, // writes project-manifest.json for CI aggregation
    }),
  ],
};
```

## Analysis depth

| Depth | What it finds | Speed |
|-------|--------------|-------|
| `'direct'` | Explicit `import` / `require` statements | Fast (ms) |
| `'local-graph'` *(default)* | + packages reachable via barrel re-exports and local wrappers | Slower (seconds) |

The difference matters when your project uses barrel files:

```ts
// src/shared/index.ts
export { observer } from 'mobx-react';    // re-export
export { makeAutoObservable } from 'mobx'; // re-export

// src/app.tsx
import { observer } from './shared';  // relative import — direct mode stops here
```

- **`depth: 'direct'`** sees `./shared` (relative) → skips. `mobx` not found.
- **`depth: 'local-graph'`** follows `./shared` → finds `mobx` and `mobx-react` via re-export.

## TypeScript path aliases

```typescript
// tsconfig.json
{ "compilerOptions": { "paths": { "@components/*": ["src/components/*"] } } }

await buildProjectManifest({
  sourceDirs: ['./src'],
  tsconfigPath: './tsconfig.json', // enables alias resolution
});
```

Without `tsconfigPath`, `@components/Button` is treated as an external package and packages imported inside it are invisible in `local-graph` mode.

## CI pipeline: project → federation

Each microfrontend generates a manifest as a build artifact, then they're aggregated for cross-team analysis:

```yaml
# .github/workflows/build.yml
jobs:
  build-checkout:
    steps:
      - run: npm run build   # MfSharedInspectorPlugin writes project-manifest.json
      - uses: actions/upload-artifact@v4
        with: { name: manifest-checkout, path: project-manifest.json }
```

```typescript
import { analyzeFederation, formatFederationReport, scoreFederationReport } from '@mf-toolkit/shared-inspector';

const report = analyzeFederation([checkoutManifest, catalogManifest, cartManifest]);
const { score, label } = scoreFederationReport(report);

console.log(formatFederationReport(report));
// ⚠  Version Conflict — react
//    checkout: ^17.0.0
//    catalog: ^18.0.0
//    → Risk: MF singleton negotiation will silently load wrong version → Invalid hook call
//    💡 Fix: shared: { react: { singleton: true, requiredVersion: "^18.0.0" } }
//
// Score: 60/100  🟠 RISKY
```

Or use the CLI directly:

```bash
npx @mf-toolkit/shared-inspector federation checkout.json catalog.json cart.json
```

## API reference

### `buildProjectManifest(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | — | Project name |
| `sourceDirs` | `string[]` | — | Directories to scan |
| `depth` | `'direct' \| 'local-graph'` | `'local-graph'` | Scan depth |
| `sharedConfig` | `Record<string, SharedDepConfig>` | `{}` | MF shared config |
| `packageJsonPath` | `string` | `'./package.json'` | Path to package.json |
| `extensions` | `string[]` | `['.ts','.tsx','.js','.jsx']` | File extensions |
| `ignore` | `string[]` | `[]` | Packages to exclude (supports `@scope/*`) |
| `tsconfigPath` | `string` | `undefined` | tsconfig.json for path alias resolution |
| `workspacePackages` | `string[]` | `[]` | Local monorepo packages to exclude |
| `kind` | `'host' \| 'remote' \| 'unknown'` | `'unknown'` | Project role |

### `analyzeProject(manifest, options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `alwaysShared` | `string[]` | `['react','react-dom']` | Never flag as unused |
| `additionalCandidates` | `string[]` | `[]` | Extend built-in candidates list |
| `additionalSingletonRisks` | `string[]` | `[]` | Extend built-in singleton-risk list |

### `scoreProjectReport(report)` / `scoreFederationReport(report)`

Returns a `RiskScore`:

```typescript
interface RiskScore {
  score: number;                           // 0–100, higher is better
  label: 'HEALTHY' | 'GOOD' | 'RISKY' | 'CRITICAL';
  high: number;                            // count of high-severity findings
  medium: number;                          // count of medium-severity findings
  low: number;                             // count of low-severity findings
}
```

### `analyzeFederation(manifests, options?)`

Accepts N `ProjectManifest` objects (one per microfrontend) and returns a `FederationReport`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `alwaysShared` | `string[]` | `['react','react-dom']` | Exclude from ghost/gap detection |

### `MfSharedInspectorPlugin` options

Extends all `buildProjectManifest` options (except `name`, auto-resolved from compiler) plus:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `warn` | `boolean` | `true` | Print findings to console |
| `failOn` | `'mismatch' \| 'unused' \| 'any'` | `undefined` | Fail the build when findings match |
| `writeManifest` | `boolean` | `false` | Write `project-manifest.json` to `outputDir` |
| `outputDir` | `string` | `'.'` | Directory for manifest output |
| `analysis` | `AnalysisOptions` | `{}` | Options forwarded to `analyzeProject` |

## Detection categories

### Per-project (`analyzeProject`)

| Category | Severity | Description |
|----------|----------|-------------|
| `mismatched` | 🔴 HIGH | `requiredVersion` doesn't satisfy installed version |
| `singletonRisks` | 🟠 MEDIUM | Global-state packages shared without `singleton: true` |
| `eagerRisks` | 🟠 MEDIUM | `eager: true` without `singleton: true` |
| `candidates` | 🟠 MEDIUM | Used packages missing from `shared` (each MF bundles own copy) |
| `unused` | 🟡 LOW | In `shared` config but not observed in scanned sources |

### Cross-MF (`analyzeFederation`)

| Category | Severity | Description |
|----------|----------|-------------|
| `versionConflicts` | 🔴 HIGH | `requiredVersion` ranges across MFs have no overlap |
| `singletonMismatches` | 🟠 MEDIUM | `singleton: true` in some MFs, absent in others |
| `hostGaps` | 🟠 MEDIUM | Package used by 2+ MFs but not declared in `shared` by anyone |
| `ghostShares` | 🟡 LOW | Package in `shared` of one MF, unused/unshared by all others |

## Known limitations

- **TypeScript path aliases without `tsconfigPath`**: aliased imports are treated as external package names.
- **Dynamic imports with variables** (`import(moduleName)`): not analysed — requires runtime information.
- **Exact tsconfig alias patterns** (non-wildcard): only `"@alias/*"` wildcard form is supported.
- **Subclassed `ModuleFederationPlugin`**: auto-extraction matches by constructor name — pass `sharedConfig` explicitly for custom subclasses.

## License

MIT
