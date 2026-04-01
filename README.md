# mf-toolkit

[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js)](https://nodejs.org)

Build-time optimization tools for microfrontend architectures. Each package works independently and is published separately to npm.

---

## Packages

### 🎯 SVG Sprite Optimization — [@mf-toolkit/sprite-plugin](./packages/sprite-plugin)

[![npm version](https://img.shields.io/npm/v/@mf-toolkit/sprite-plugin?color=CB3837&logo=npm)](https://www.npmjs.com/package/@mf-toolkit/sprite-plugin)
<img src="https://img.shields.io/badge/analyzer_deps-zero_by_default-brightgreen" alt="zero deps" />
<img src="https://img.shields.io/badge/size-17_KB-blue" alt="size" />

![SVG sprite optimization: 319 icons → 38 used, 88% reduction](./packages/sprite-plugin/assets/feature.png)

**Your design system has 500 icons. Your microfrontend uses 12. Why ship all of them?**

A webpack plugin (and standalone tool) that statically analyzes your source code, detects which SVG icons are actually imported, and generates an optimized sprite containing only those icons. Like tree-shaking, but for SVG sprites.

⚡ **88% bundle reduction** tested on a production app — 319 icons in design system → 38 actually used

```bash
npm install @mf-toolkit/sprite-plugin --save-dev
```

```js
// webpack.config.js — 4 lines to optimize your icon bundle
new MfSpriteWebpackPlugin({
  iconsDir: './src/assets/icons',
  sourceDirs: ['./src'],
  importPattern: /@my-ui\/icons\/(.+)/,
  output: './src/generated/sprite.ts',
});
```

**What it does:**

- 🔍 Scans all import patterns — static, dynamic `import()`, `require()`, `React.lazy`, `.then()` destructuring
- 🧠 Smart name matching — `ChevronRight` → `chevron-right.svg`, `Coupon2` → `coupon-2.svg`
- ⚙️ SVG optimization via [SVGO](https://github.com/svg/svgo) — strips metadata, replaces hardcoded colors with `currentColor`
- 🔒 ID collision protection — auto-prefixes internal SVG IDs to prevent gradient/mask conflicts
- 🔌 Pluggable parsers — regex (zero deps), TypeScript Compiler API, or Babel — your choice
- 📊 Build manifest for CI — JSON report of which icons were included/missing

> **Zero analyzer dependencies by default.** Regex-based parsing keeps install at **17 KB**. Need full AST accuracy? Opt into `parser: 'typescript'` or `parser: 'babel'` — loaded dynamically, zero cost if unused.

[![📖 Full docs, API reference & examples →](https://img.shields.io/badge/📖_Full_docs_&_API_reference_→-blue?style=for-the-badge)](./packages/sprite-plugin)

---

### 🔬 MF Shared Inspector — [@mf-toolkit/shared-inspector](./packages/shared-inspector)

[![npm version](https://img.shields.io/npm/v/@mf-toolkit/shared-inspector?color=CB3837&logo=npm)](https://www.npmjs.com/package/@mf-toolkit/shared-inspector)
[![node](https://img.shields.io/node/v/@mf-toolkit/shared-inspector?color=339933&logo=node.js)](https://nodejs.org)

**Your `shared` config is probably wrong. Find out before it ships.**

A build-time analyzer for Module Federation `shared` config. Detects version mismatches, singleton gaps, over-sharing, and under-sharing — with zero runtime impact. Also supports federation-level analysis by aggregating manifests from multiple microfrontends, enabling detection of cross-app dependency conflicts. Provides machine-readable JSON output for CI/CD pipelines and can be configured to fail builds on critical issues.

```bash
npm install @mf-toolkit/shared-inspector --save-dev
```

**What it does:**

- 🔍 **Detects** version mismatches, singleton gaps, over-sharing, and under-sharing
- 🔗 **Federation analysis** — aggregates manifests across microfrontends, catches cross-app conflicts
- 📊 **Risk scoring** — every finding ranked by severity with a ready-to-paste fix
- 🔌 **Webpack plugin** — auto-extracts `shared` config, optionally fails the build
- 📋 **JSON output** — machine-readable report for CI/CD integration

[![📖 Full docs, API reference & examples →](https://img.shields.io/badge/📖_Full_docs_&_API_reference_→-blue?style=for-the-badge)](./packages/shared-inspector)

---

## Philosophy

- ⚡ **Build-time over runtime.** Optimize at build, ship less to the browser.
- 📦 **Use what you need.** Every package is published independently to npm. No forced coupling.
- 🪶 **Minimal dependencies.** Zero deps by default. No glob libraries — just the Node.js standard library.

## License

MIT
