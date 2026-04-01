# `@mf-toolkit/shared-inspector`

[![npm version](https://img.shields.io/npm/v/@mf-toolkit/shared-inspector?color=CB3837&logo=npm)](https://www.npmjs.com/package/@mf-toolkit/shared-inspector)
[![license](https://img.shields.io/npm/l/@mf-toolkit/shared-inspector?color=blue)](https://github.com/zvitaly7/mf-toolkit/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@mf-toolkit/shared-inspector?color=339933&logo=node.js)](https://nodejs.org)

**Validate Module Federation `shared` config at build time.**

`shared` config errors are silent — mismatched versions, broken singleton negotiation, duplicate instances in the bundle. `shared-inspector` surfaces these issues before they reach production. Every finding includes a risk score and a ready-to-paste fix.

## The problem

Module Federation teams manually manage `shared` config and make three kinds of mistakes:

- **Over-sharing** — packages listed in `shared` that the microfrontend never imports. Creates artificial version coupling between independent teams.
- **Under-sharing** — packages used by both host and remote but missing from `shared`. Each microfrontend may bundle its own copy (e.g. multiple React instances, each ~130 KB).
- **Version mismatch** — `requiredVersion` doesn't match the installed version. Module Federation silently falls back to a local bundle. For packages with global state (React, styled-components) this causes "Invalid hook call" in production.

Existing tools (webpack-bundle-analyzer, source-map-explorer) show *what ended up in the bundle*, not *why shared config is suboptimal*. Different questions.

## Why not bundle analyzer?

Bundle analyzers (webpack-bundle-analyzer, source-map-explorer, stats.json inspection) answer a different question: *what is in the output?* They are useful for auditing final bundle size, but they don't model Module Federation's shared dependency negotiation.

| Question | Bundle analyzer | shared-inspector |
|----------|----------------|-----------------|
| Which packages are large? | ✅ | — |
| Is React duplicated across MFs? | Visible after the fact | ✅ Detected before build ships |
| Is `requiredVersion` out of sync with the installed version? | ✗ | ✅ |
| Is a package marked `singleton` in one MF but not another? | ✗ | ✅ |
| Which packages are declared `shared` but never imported? | ✗ | ✅ |
| Which used packages are missing from `shared` entirely? | ✗ | ✅ |
| Cross-MF version conflicts across teams? | ✗ | ✅ via federation manifests |

In short: bundle analyzers are useful for post-build inspection. `shared-inspector` is focused on the `shared` config itself — catching misconfiguration at build time and explaining what the runtime consequences would be.

## Example

A `shell` host app (React 18) and a `checkout` remote have been developed by separate teams. Their `shared` configs have drifted:

```js
// shell — webpack.config.js
shared: {
  react:     { singleton: true, requiredVersion: '^18.2.0' },
  'react-dom': { singleton: true, requiredVersion: '^18.2.0' },
  zustand:   { singleton: true },
}

// checkout — webpack.config.js
shared: {
  react:     { singleton: true, requiredVersion: '^17.0.2' }, // ← stale version
  'react-dom': { singleton: true, requiredVersion: '^17.0.2' },
  lodash:    {},                                               // ← never imported
  // zustand: missing — checkout imports it, but it's not in shared
}
```

Running `npx @mf-toolkit/shared-inspector` in the `checkout` project:

```
[MfSharedInspector] checkout (depth: local-graph, 34 files scanned)
────────────────────────────────────────────────────────────

⚠  Version Mismatch — react
   configured: ^17.0.2 | installed: 17.0.2
   → Risk: Invalid hook call, broken context across MFs
   💡 Fix:
   shared: {
     react: { singleton: true, requiredVersion: "^18.2.0" }
   }

→  Not Shared — zustand (8 imports in 5 files)
   → Risk: Each MF may get its own store instance — state changes may not propagate across MFs
   💡 Fix:
   shared: {
     zustand: { singleton: true }
   }

✗  Unused Shared — lodash
   0 imports, shared without singleton
   → Wastes bundle negotiation overhead with no benefit
   💡 Fix: Remove "lodash" from shared config

────────────────────────────────────────────────────────────
Score: 69/100  🟠 RISKY
```

**After manually updating the config based on the suggestions above** — `react` version aligned, `zustand` added to `shared`, `lodash` removed:

```
Score: 100/100  ✅ HEALTHY
```

The cross-team federation report also clears: `shell` and `checkout` now negotiate a single React instance and a single Zustand store at runtime.

## Installation

```bash
npm install --save-dev @mf-toolkit/shared-inspector
```

## Quick start

Run against any MF project — no config file needed:

```bash
npx @mf-toolkit/shared-inspector
```

The tool scans `./src`, reads installed versions from `package.json`, and prints a diagnostic report. Each finding includes what's wrong, what breaks at runtime, and a ready-to-paste fix:

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
   → Risk: Each MF may get its own MobX instance — observables and reactions can fail to sync between MFs
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

### Risk scoring

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

## CI mode

Integrate into build pipelines to fail on findings, gate on score, or emit manifests for later federation analysis.

### Failing the build

Use `--fail-on` to exit with code 1 when specific findings are detected:

```bash
npx @mf-toolkit/shared-inspector --source ./src --shared react,react-dom --fail-on mismatch
```

With the webpack plugin:

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
      failOn: 'mismatch', // 'mismatch' | 'unused' | 'any'
      warn: true,
    }),
  ],
};
```

### Gating on score

Use `scoreProjectReport` programmatically to set custom thresholds:

```typescript
import { analyzeProject, scoreProjectReport } from '@mf-toolkit/shared-inspector';

const report = analyzeProject(manifest);
const { score, label, high, medium, low } = scoreProjectReport(report);

if (score < 70) {
  console.error(`Shared config score: ${score}/100 (${label})`);
  process.exit(1);
}
```

### Writing manifests for federation analysis

Each MF can emit a `project-manifest.json` as a build artifact to enable cross-team analysis in a later step:

```bash
npx @mf-toolkit/shared-inspector --shared ./shared-config.json --write-manifest
```

With the webpack plugin:

```typescript
new MfSharedInspectorPlugin({
  sourceDirs: ['./src'],
  writeManifest: true, // writes project-manifest.json for CI aggregation
  warn: true,
})
```

Upload the manifest as a CI artifact:

```yaml
# .github/workflows/build.yml
jobs:
  build-checkout:
    steps:
      - run: npm run build   # MfSharedInspectorPlugin writes project-manifest.json
      - uses: actions/upload-artifact@v4
        with: { name: manifest-checkout, path: project-manifest.json }
```

## Federation mode

Once each MF has emitted its manifest, aggregate them to detect cross-team conflicts: version mismatches, singleton inconsistencies, and shared-config gaps across host and remotes.

Manifests can be local files or HTTP/HTTPS URLs — making federation analysis work across separate repositories without manual file passing.

### CLI

```bash
# Local files (monorepo or pre-downloaded)
npx @mf-toolkit/shared-inspector federation checkout.json catalog.json cart.json

# URLs — fetch manifests directly from remote storage
npx @mf-toolkit/shared-inspector federation \
  https://storage.example.com/manifests/checkout.json \
  https://storage.example.com/manifests/cart.json \
  https://storage.example.com/manifests/catalog.json

# Mix of local files and URLs
npx @mf-toolkit/shared-inspector federation checkout.json https://storage.example.com/cart.json
```

### Polyrepo setup

In a polyrepo, each team owns a separate repository. The recommended workflow:

**Step 1 — each MF repo publishes its manifest on every build:**

```yaml
# .github/workflows/build.yml (in each MF repo)
jobs:
  build:
    steps:
      - run: npm run build        # MfSharedInspectorPlugin writes project-manifest.json
      - uses: actions/upload-artifact@v4
        with: { name: manifest-${{ github.event.repository.name }}, path: project-manifest.json }
```

**Step 2 — a dedicated federation-check job downloads all manifests and runs analysis:**

```yaml
# .github/workflows/federation-check.yml (in a shared/platform repo)
jobs:
  federation-check:
    steps:
      - uses: actions/download-artifact@v4
        with: { name: manifest-checkout, github-token: ${{ secrets.GITHUB_TOKEN }}, repository: org/checkout, run-id: ... }
      - uses: actions/download-artifact@v4
        with: { name: manifest-cart, github-token: ${{ secrets.GITHUB_TOKEN }}, repository: org/cart, run-id: ... }
      - run: |
          npx @mf-toolkit/shared-inspector federation \
            manifest-checkout/project-manifest.json \
            manifest-cart/project-manifest.json
```

Alternatively, upload manifests to a shared HTTP storage (S3, CDN, object store) and use URL inputs directly — no artifact coordination required:

```yaml
      - run: |
          npx @mf-toolkit/shared-inspector federation \
            https://manifests.internal/checkout/latest.json \
            https://manifests.internal/cart/latest.json
```

### Programmatic

```typescript
import { analyzeFederation, formatFederationReport, scoreFederationReport } from '@mf-toolkit/shared-inspector';

const report = analyzeFederation([checkoutManifest, catalogManifest, cartManifest]);
const { score, label } = scoreFederationReport(report);

console.log(formatFederationReport(report));
// ⚠  Version Conflict — react
//    checkout: ^17.0.0
//    catalog: ^18.0.0
//    → Risk: MF singleton negotiation may silently load the wrong version → Invalid hook call
//    💡 Fix: shared: { react: { singleton: true, requiredVersion: "^18.0.0" } }
//
// Score: 60/100  🟠 RISKY
```

## Programmatic API

### Two-phase API

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

## Interactive wizard

Not sure which flags to pass? Run the step-by-step wizard:

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

## CLI reference

| Flag | Default | Description |
|------|---------|-------------|
| `--source, -s <dirs>` | `./src` | Source dirs to scan, comma-separated |
| `--depth <depth>` | `local-graph` | Scan depth: `direct` \| `local-graph` |
| `--shared <packages\|file>` | — | Comma-separated package names or path to `.json` config |
| `--tsconfig <path>` | — | tsconfig.json for path alias resolution |
| `--workspace-packages <pkgs>` | — | Comma-separated workspace packages to exclude |
| `--name <name>` | auto from `package.json` | Project name |
| `--kind <kind>` | `unknown` | Project role: `host` \| `remote` \| `unknown` |
| `--fail-on <rule>` | — | Exit 1 when findings match: `mismatch` \| `unused` \| `any` |
| `--min-score <n>` | — | Exit 1 when score is below n (0–100) |
| `--json` | `false` | Output findings as JSON (suppresses spinner and banner) |
| `--write-manifest` | `false` | Write `project-manifest.json` to output dir |
| `--output-dir <dir>` | `.` | Output directory for manifest |
| `--interactive, -i` | — | Launch step-by-step wizard |
| `--version, -v` | — | Print version and exit |
| `--help, -h` | — | Show help |

**Federation subcommand:**

```bash
mf-inspector federation <manifest1> [manifest2...] [--fail-on <rule>] [--min-score <n>] [--json]
```

Each manifest can be a local file path or an `http(s)://` URL. Local paths are resolved relative to the current working directory.

| Flag | Description |
|------|-------------|
| `--fail-on <rule>` | Exit 1 when findings match: `mismatch` (version conflicts) \| `unused` (ghost shares) \| `any` |
| `--min-score <n>` | Exit 1 when federation score is below n |
| `--json` | Output findings as JSON |

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

### `writeReport(report, outputPath)` / `writeManifest(manifest, outputPath)`

Write a `ProjectReport` or `ProjectManifest` to a JSON file. Parent directories are created automatically.

```typescript
import { writeReport, writeManifest } from '@mf-toolkit/shared-inspector';

await writeReport(report, './dist/shared-report.json');
await writeManifest(manifest, './dist/project-manifest.json');
```

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

## How it works

Four steps, no magic:

1. **Scan** — statically extracts import/require statements from source files
2. **Normalize** — reads your declared `shared` config (explicit or auto-extracted from `ModuleFederationPlugin`)
3. **Resolve** — reads installed versions from `node_modules` to detect `requiredVersion` drift
4. **Cross-reference** — produces findings, a risk score, and optionally a `project-manifest.json` for federation analysis

No webpack build required. Runs in seconds on the source tree directly.

## When not to use this tool

- You are not using Module Federation (webpack or rspack)
- Your `shared` config is intentionally empty or minimal by design
- You only need bundle size analysis — use [webpack-bundle-analyzer](https://github.com/webpack-contrib/webpack-bundle-analyzer) instead
- Your MF setup uses dynamic runtime sharing with non-standard orchestration that doesn't rely on the `shared` config

## Known limitations

- **TypeScript path aliases without `tsconfigPath`**: aliased imports are treated as external package names.
- **Dynamic imports with variables** (`import(moduleName)`): not analysed — requires runtime information.
- **Exact tsconfig alias patterns** (non-wildcard): only `"@alias/*"` wildcard form is supported.
- **Subclassed `ModuleFederationPlugin`**: auto-extraction matches by constructor name — pass `sharedConfig` explicitly for custom subclasses.

## License

MIT
