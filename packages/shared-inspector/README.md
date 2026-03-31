# `@mf-toolkit/shared-inspector`

[![npm version](https://img.shields.io/npm/v/@mf-toolkit/shared-inspector?color=CB3837&logo=npm)](https://www.npmjs.com/package/@mf-toolkit/shared-inspector)
[![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/zvitaly7/mf-toolkit/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js)](https://nodejs.org)

> **v0.3.0** — published to npm. 252 tests. API is stable; minor changes possible before v1.0.

Build-time analyser for Module Federation `shared` dependencies. Two-phase architecture: **collect facts → analyse facts**.

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

## Quick start

### Programmatic API (two-phase)

```typescript
import { buildProjectManifest, analyzeProject } from '@mf-toolkit/shared-inspector';

// Phase 1: collect facts
const manifest = await buildProjectManifest({
  name: 'checkout',
  sourceDirs: ['./src'],
  sharedConfig: {
    react: { singleton: true, requiredVersion: '^19.0.0' },
    'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
    lodash: {},
  },
  // depth: 'local-graph'       ← default, follows barrel re-exports
  // tsconfigPath: './tsconfig.json'  ← optional, resolves @alias/* imports
  // workspacePackages: ['@my-org/*'] ← optional, excludes local monorepo packages
});

// Phase 2: analyse facts
const report = analyzeProject(manifest, {
  alwaysShared: ['react', 'react-dom'],
});

console.log(report.unused);
// [{ package: 'lodash', singleton: false }]

console.log(report.candidates);
// [{ package: 'mobx', importCount: 12, via: 'reexport', files: ['src/shared/index.ts'] }]

console.log(report.mismatched);
// [{ package: 'react', configured: '^19.0.0', installed: '18.3.1' }]

console.log(report.eagerRisks);
// [{ package: 'react-dom' }]  ← eager: true without singleton: true
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

Pass `sharedConfig` explicitly to override auto-extraction:

```typescript
new MfSharedInspectorPlugin({
  sourceDirs: ['./src'],
  sharedConfig: { react: { singleton: true, requiredVersion: '^18.0.0' } },
})
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
```

```ts
// src/app.tsx
import { observer } from './shared';  // relative import — direct mode stops here
```

- **`depth: 'direct'`** scans `app.tsx`, sees `./shared` (relative) → skips. `mobx` not found.
- **`depth: 'local-graph'`** follows `./shared` → `shared/index.ts` → finds `mobx` and `mobx-react` via re-export.

## TypeScript path aliases

When your project uses `paths` in `tsconfig.json`, pass `tsconfigPath` so the traverser follows aliased imports into local files instead of treating them as external packages:

```typescript
// tsconfig.json
{ "compilerOptions": { "baseUrl": ".", "paths": { "@components/*": ["src/components/*"] } } }

// src/app.tsx
import { Button } from '@components/Button'; // ← followed as local file, not external package
```

```typescript
await buildProjectManifest({
  sourceDirs: ['./src'],
  tsconfigPath: './tsconfig.json', // enables alias resolution
});
```

Without `tsconfigPath`, `@components/Button` is treated as an external package name and packages imported inside it are invisible in local-graph mode.

## Workspace packages

In a monorepo where local packages import each other, use `workspacePackages` to prevent internal packages from appearing in `resolvedPackages`:

```typescript
await buildProjectManifest({
  sourceDirs: ['./src'],
  workspacePackages: ['@my-org/design-system', '@my-org/*'],
});
```

## Terminal output

```
[MfSharedInspector] checkout (depth: local-graph, 47 files scanned)

  Version mismatch (sharing silently broken):
    ⚠ react — requires ^19.0.0, installed 18.3.1

  Unused shared (safe to remove):
    ✗ lodash — 0 imports, shared without singleton
    ✗ @tanstack/react-query — 0 imports, shared as singleton

  Candidates (consider adding to shared):
    → mobx (12 imports in 8 files, via re-export in src/shared/index.ts)
    → react-router-dom (6 imports in 4 files)

  Singleton risks (add singleton: true):
    ⚠ react-router-dom — manages global state, singleton: true recommended

  Eager risks (add singleton: true or remove eager: true):
    ⚠ react-dom — eager: true without singleton: true, risk of duplicate instances

  Total: 12 shared, 10 used, 2 unused, 2 candidates, 1 mismatch, 1 eager risks
```

## CI pipeline: project → federation

Each microfrontend generates a manifest as a build artifact:

```yaml
jobs:
  build-checkout:
    steps:
      - run: npm run build   # MfSharedInspectorPlugin writes project-manifest.json
      - uses: actions/upload-artifact@v4
        with:
          name: manifest-checkout
          path: project-manifest.json
```

Each MF manifest can then be aggregated for cross-team analysis:

```typescript
import { analyzeFederation, formatFederationReport } from '@mf-toolkit/shared-inspector';

const report = analyzeFederation([checkoutManifest, catalogManifest, cartManifest]);
console.log(formatFederationReport(report));
```

```
[MfSharedInspector] federation analysis (3 MFs)

  Version conflicts (singleton negotiation will fail):
    ⚠ react — checkout: ^17.0.0, catalog: ^18.0.0

  Singleton mismatches (add singleton: true to all MFs):
    ⚠ mobx — singleton in [checkout], not singleton in [catalog, cart]

  Host gaps (add to shared — each MF bundles its own copy):
    → axios — used by [checkout, catalog], not in shared

  Ghost shares (remove from shared — no other MF benefits):
    ✗ lodash — shared only by cart, unused by all other MFs

  Total: 3 MFs, 1 version conflicts, 1 singleton mismatches, 1 host gaps, 1 ghost shares
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

### `analyzeFederation(manifests, options?)`

Accepts N `ProjectManifest` objects (one per microfrontend) and returns a `FederationReport`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `alwaysShared` | `string[]` | `['react','react-dom']` | Exclude from ghost/gap detection |

### `formatFederationReport(report)`

Formats a `FederationReport` as a human-readable terminal string.

### `MfSharedInspectorPlugin` options

Extends all `buildProjectManifest` options (except `name`, auto-resolved from compiler) plus:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sourceDirs` | `string[]` | — | Directories to scan |
| `sharedConfig` | `Record<string, SharedDepConfig>` | auto-extracted | Override auto-extraction from `ModuleFederationPlugin` |
| `tsconfigPath` | `string` | `undefined` | tsconfig.json for path alias resolution |
| `workspacePackages` | `string[]` | `[]` | Local monorepo packages to exclude |
| `warn` | `boolean` | `true` | Print findings to console |
| `failOn` | `'mismatch' \| 'unused' \| 'any'` | `undefined` | Fail the build when findings match |
| `writeManifest` | `boolean` | `false` | Write `project-manifest.json` to `outputDir` |
| `outputDir` | `string` | `'.'` | Directory for manifest output |
| `analysis` | `AnalysisOptions` | `{}` | Options forwarded to `analyzeProject` |

## Detection categories

### Per-project (`analyzeProject`)

| Category | Type | Description |
|----------|------|-------------|
| `mismatched` | Deterministic | `requiredVersion` doesn't satisfy installed version |
| `unused` | Deterministic* | In `shared` config but not observed in scanned sources |
| `candidates` | Heuristic | Observed packages not in `shared` that are typically shared |
| `singletonRisks` | Heuristic | Global-state packages shared without `singleton: true` |
| `eagerRisks` | Heuristic | `eager: true` without `singleton: true` — risk of duplicate instances |

*Within the visibility of the chosen depth.*

### Cross-MF (`analyzeFederation`)

| Category | Type | Description |
|----------|------|-------------|
| `versionConflicts` | Deterministic | `requiredVersion` ranges across MFs have no overlap |
| `singletonMismatches` | Deterministic | `singleton: true` in some MFs, absent in others |
| `hostGaps` | Heuristic | Package used by 2+ MFs but not declared in `shared` by anyone |
| `ghostShares` | Heuristic | Package in `shared` of one MF, unused/unshared by all others |

## Known limitations

- **TypeScript path aliases without `tsconfigPath`**: aliased imports are treated as external package names. Pass `tsconfigPath` to resolve them correctly.
- **Dynamic imports with variables** (`import(moduleName)`): not analysed — requires runtime information.
- **Exact tsconfig alias patterns** (non-wildcard, e.g. `"@root": ["."]`): not supported, only `"@alias/*"` wildcard form.
- **Subclassed `ModuleFederationPlugin`**: auto-extraction matches by constructor name. A custom subclass (`class MyMFP extends ModuleFederationPlugin`) won't be detected — pass `sharedConfig` explicitly in that case.

## Demo

```bash
npx tsx packages/shared-inspector/demo/run.ts
```

## License

MIT
