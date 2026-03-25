# mf-toolkit

Build-time and runtime tools for microfrontend architectures. Each package is **independent** — install only what you need.

---

## @mf-toolkit/sprite-plugin

**Your monolith has 500 icons. Your microfrontend uses 12. Why ship all of them?**

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

**What it does:**
- Scans your code for icon imports (static, dynamic, `require`, `import type`, re-exports)
- Matches them to SVG files in your icons directory
- Optimizes each SVG with [SVGO](https://github.com/svg/svgo) and replaces hardcoded colors with `currentColor`
- Generates a TypeScript module that injects the sprite into the DOM
- Runs automatically before each build and on watch-mode rebuilds

**Zero runtime dependencies** besides SVGO. The analyzer uses no external parsers — just Node.js built-ins.

[Full documentation and configuration guide →](./packages/sprite-plugin)

---

## Philosophy

- **Use what you need.** Every package is published independently to npm. No forced coupling.
- **Minimal dependencies.** If it can be done with Node.js built-ins, it should be.
- **Build-time over runtime.** Optimize at build, ship less to the browser.

## License

MIT
