# mf-toolkit

![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js)

Build-time and runtime tools for **microfrontend architectures**. Each package is independent — install only what you need.

---

## Packages

### [@mf-toolkit/sprite-plugin](./packages/sprite-plugin)

![npm](https://img.shields.io/badge/npm-@mf--toolkit/sprite--plugin-CB3837?logo=npm)
![zero deps](https://img.shields.io/badge/analyzer_deps-zero-brightgreen)

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

> **No Babel, no AST.** The analyzer intentionally uses regex-based parsing with only Node.js built-ins — keeping the install footprint at **17 KB** instead of adding 5+ MB of parser dependencies. Tested against a production codebase: identical results compared to a Babel-based analyzer.

[Full documentation and API reference →](./packages/sprite-plugin)

---

## Philosophy

- **Use what you need.** Every package is published independently to npm. No forced coupling.
- **Minimal dependencies.** If it can be done with Node.js built-ins, it should be. No AST parsers, no glob libraries — just the standard library.
- **Build-time over runtime.** Optimize at build, ship less to the browser.

## License

MIT
