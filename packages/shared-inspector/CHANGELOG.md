# Changelog

All notable changes to `@mf-toolkit/shared-inspector` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.6.0] — 2026-04-26

Two new detector classes and a redesigned federation pipeline. Most CLI users
upgrade transparently — the breaking changes are scoped to programmatic
consumers of `ProjectManifest` / `ProjectReport`.

### Added

- **Deep-import bypass detector** — flags shared packages whose source code
  imports subpaths directly (e.g. `lodash` declared in `shared`, but code
  uses `import cloneDeep from 'lodash/cloneDeep'`). Webpack/Rspack MF only
  routes through shared scope on exact key match, so subpath imports bundle
  into every MF independently and the shared declaration silently has no
  effect. New `deepImportBypass` category in `ProjectReport`, scored as
  HIGH severity. Allowlist configurable via `AnalysisOptions.deepImportAllowlist`;
  defaults exclude `react/jsx-runtime` and `react/jsx-dev-runtime` (used by
  the JSX automatic runtime, intentional). Per-package risk text for `lodash`,
  `rxjs`, `date-fns`, `@mui/material`, `@mui/icons-material`.

- **Module Federation 2.0 manifest ingestion** — the `federation` command
  auto-detects and consumes `mf-manifest.json` emitted natively by
  `@module-federation/enhanced` (Webpack, **Rspack**, **Vite via
  `@module-federation/vite`**, Next.js MF). No plugin integration required
  for federation analysis — point the CLI at the build artefacts and go.
  Inherited shared (entry.from !== name) is filtered to avoid double-counting
  host deps inside remotes. Versions are read from the manifest itself
  (post-resolution from the bundler), strictly more accurate than reading
  `package.json`. Public API exposes `isMf2Manifest`, `adaptMf2Manifest` and
  the `Mf2RawManifest` / `Mf2SharedEntry` types.

- **Singleton-risk and share-candidate lists extended** — added `react-redux`,
  `zustand`, `jotai`, `recoil`, `@tanstack/react-query`, `swr`,
  `@apollo/client`, `urql`. The first five already had per-package
  diagnostics text but were missing from the detector list, so findings
  for them were silently suppressed.

- **26 stress tests** covering deep-import patterns (CommonJS require,
  dynamic import with literal subpath, mixed root + subpath, scoped
  packages, dedup across files, local-graph propagation through barrel
  re-exports, allowlist subtraction, 50-subpath bulk) and MF 2.0 ingestion
  (5-MF federation E2E, inherited filtering, malformed-entry defence,
  mixed native + adapted manifests, 50-package bulk, kind inference).

### Changed

- **`ProjectManifest` schemaVersion bumped 1 → 2.** The new schema is a
  superset of v1: `usage.packageDetails[]` items gain a `deepImports: string[]`
  field listing distinct subpath specifiers observed for that package.
  Inspector reads only the new schema. This is breaking for anyone
  persisting v1 manifests and parsing them with this library; CLI-only users
  are unaffected because manifests are regenerated on every build.

- **`PackageOccurrence` carries a raw `specifier`** alongside the normalised
  `package` name. Both collectors emit one occurrence per distinct
  `(package, file, specifier)` triple, enabling the deep-import detector
  without losing per-file aggregation.

- **`ProjectReport` shape extended** with `deepImportBypass: DeepImportBypassEntry[]`
  and `summary.deepImportBypassCount`. Existing fields and behaviour
  unchanged.

- **README rewrite around the new scope** — replaced obsolete
  «Once each MF has emitted its manifest» framing with an MF 2.0-first
  narrative; collapsed Polyrepo setup into MF 2.0 (recommended) + MF 1.0
  (fallback) tracks; added the deep-import row to the bundle-analyzer
  comparison table and the new section to detection categories. Net −14
  lines while documenting more.

### Fixed

- **Singleton-risk list synced with the diagnostics knowledge base.**
  Findings for `zustand`, `jotai`, `recoil`, `@tanstack/react-query`, `swr`
  had risk text written but were never emitted because the detector list
  did not include them. Now consistent.

### Migration

- **CLI users**: no action required. All flags (`--source`, `--shared`,
  `--depth`, `--write-manifest`, `--fail-on`, `--min-score`, `federation`,
  etc.) keep their names and semantics. JSON output adds the new
  `deepImportBypass` field; existing fields are preserved.

- **Programmatic consumers**: if you build `ProjectManifest` /
  `PackageOccurrence` / `ProjectReport` values by hand (tests, custom
  pipelines, etc.), add the new required fields:
    - `PackageOccurrence.specifier` (set to `package` value for root imports)
    - `packageDetails[].deepImports` (set to `[]` if you don't track subpaths)
    - `ProjectReport.deepImportBypass` (set to `[]`) and
      `summary.deepImportBypassCount` (set to `0`)
    - `ProjectManifest.schemaVersion` (set to `2`)
  TypeScript will surface every site at compile time.

- **Pre-existing `project-manifest.json` files** on disk written by 0.5.x
  are not readable by 0.6.x. Regenerate with `--write-manifest` or
  `MfSharedInspectorPlugin({ writeManifest: true })` on the next build.

---
