# mf-toolkit

![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js)

Build-time and runtime tools for **microfrontend architectures**. Each package is independent — install only what you need.

---

## Packages

### [@mf-toolkit/sprite-plugin](./packages/sprite-plugin)

[![npm version](https://img.shields.io/npm/v/@mf-toolkit/sprite-plugin?color=CB3837&logo=npm)](https://www.npmjs.com/package/@mf-toolkit/sprite-plugin)
![zero deps](https://img.shields.io/badge/analyzer_deps-zero_by_default-brightgreen)

> **Your monolith has 500 icons. Your microfrontend uses 12. Why ship all of them?**

Statically analyzes your source code, finds which icons are actually imported, and generates an optimized SVG sprite with only those icons. Works with Webpack or standalone.

```bash
npm install @mf-toolkit/sprite-plugin --save-dev
```

```js
// webpack.config.js
const { MfSpriteWebpackPlugin } = require('@mf-toolkit/sprite-plugin/webpack');

module.exports = {
  plugins: [
    new MfSpriteWebpackPlugin({
      iconsDir: './src/assets/icons',
      sourceDirs: ['./src'],
      importPattern: /@my-ui\/icons\/(.+)/,
      output: './src/generated/sprite.ts',
    }),
  ],
};
```

**Key features:**

- Scans static imports, dynamic `import()`, `require()`, `.then()` destructuring, `React.lazy` patterns
- Two modes: path-based (`import X from '@ui/icons/cart'`) and named imports (`import { Cart } from '@ui/Icon/ui'`)
- Smart matching: `ChevronRight` → `chevron-right.svg`, `Coupon2` → `coupon-2.svg`
- Subdirectory disambiguation: `ui/arrow.svg` vs `payment/arrow.svg`
- SVG optimization with [SVGO](https://github.com/svg/svgo), hardcoded colors → `currentColor`
- Internal ID prefixing to prevent gradient/mask collisions
- Optional JSON manifest for CI pipelines
- SSR-safe, idempotent sprite injection

> **Zero dependencies by default.** The analyzer uses regex-based parsing with only Node.js built-ins — keeping the install footprint at **17 KB**. Need full syntactic accuracy? Opt into TypeScript Compiler API or Babel parser via `parser: 'typescript' | 'babel'` — both are optional peer dependencies, loaded dynamically only when selected.

[Full documentation and API reference →](./packages/sprite-plugin)

---

## Philosophy

- **Use what you need.** Every package is published independently to npm. No forced coupling.
- **Minimal dependencies.** Zero deps by default, optional AST parsers for those who need them. No glob libraries — just the standard library.
- **Build-time over runtime.** Optimize at build, ship less to the browser.

## License

MIT
