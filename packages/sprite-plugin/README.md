# @mf-toolkit/sprite-plugin

**Your monolith has 500 icons. Your microfrontend uses 12. Why ship all of them?**

This plugin statically analyzes your source code, detects which icons are actually imported, and generates an optimized SVG sprite containing only those icons. Zero runtime overhead, zero manual configuration — just plug it into your build.

## The Problem

When you split a monolith into microfrontends, each one inherits the full icon sprite — hundreds of SVG symbols your app never references. That's wasted bandwidth on every page load.

Manually maintaining per-app icon lists is error-prone and doesn't scale.

## The Solution

![How @mf-toolkit/sprite-plugin works](./assets/solution-diagram.svg)

## Install

```bash
npm install @mf-toolkit/sprite-plugin --save-dev
```

## Quick Start

### With Webpack

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

### Without a Bundler

```js
// scripts/generate-sprite.mjs
import { generateSprite } from '@mf-toolkit/sprite-plugin';

await generateSprite({
  iconsDir: './src/assets/icons',
  sourceDirs: ['./src'],
  importPattern: /@my-ui\/icons\/(.+)/,
  output: './src/generated/sprite.ts',
});
```

Run it:

```bash
node scripts/generate-sprite.mjs
```

## Using the Generated Sprite

The plugin generates a TypeScript file with two exports:

```ts
// src/generated/sprite.ts (auto-generated, do not edit)

export function injectSprite(): void  // Inserts SVG sprite into the DOM
export const spriteIcons: readonly string[]  // List of included icon names
```

Call `injectSprite()` once at app startup:

```ts
// src/index.ts
import { injectSprite } from './generated/sprite';

injectSprite();
```

Then use icons via standard SVG `<use>` references:

```tsx
function CartButton() {
  return (
    <svg width="24" height="24">
      <use href="#cart" />
    </svg>
  );
}
```

The sprite is injected as a hidden `<div>` at the top of `<body>`. Icons inherit `color` from their parent via `currentColor` — no hardcoded colors.

## Configuration

### `importPattern` — How the Plugin Finds Your Icons

This is the most important option. It tells the plugin what an "icon import" looks like in your codebase.

The pattern is a regular expression applied to the **module specifier** (the string after `from` or inside `import()`). It must contain **one capture group** that extracts the icon name.

**Example:** If your imports look like this:

```ts
import { CartIcon } from '@my-ui/icons/cart';
//                        ^^^^^^^^^^^^^^^^^ module specifier
//                                          ^^^^ icon name (capture group)
```

Then your pattern is:

```js
importPattern: /@my-ui\/icons\/(.+)/
//                               ^^ captures "cart"
```

**More examples:**

```ts
// Flat imports: import Icon from 'icons/cart'
importPattern: /^icons\/(.+)/

// Scoped package: import X from '@company/icons/ui/cart'
importPattern: /@company\/icons\/(.+)/

// File-based: import X from './icons/cart.svg'
importPattern: /\.\/icons\/(.+)\.svg/
```

### `extractNamedImports` — Named Import Mode

Some codebases organize icons by category, with each category as a separate module:

```ts
import { Cart, Search } from '@ui/Icon/common';
import { ChevronRight } from '@ui/Icon/ui';
import { Arrow } from '@ui/Icon/payment';
```

In this pattern, the **icon name comes from the import specifier** (`Cart`, `Search`), not from the module path. Enable `extractNamedImports` to handle this:

```js
new MfSpriteWebpackPlugin({
  iconsDir: './src/assets/icons',
  sourceDirs: ['./src'],
  importPattern: /@ui\/Icon\/(.+)/,
  extractNamedImports: true,
  output: './src/generated/sprite.ts',
});
```

When `extractNamedImports` is enabled:
- The plugin extracts individual names from `{ Cart, Search }` instead of using the module path
- If `importPattern` has a **capture group**, the captured value is used as a **category prefix**: `Cart` from `@ui/Icon/common` becomes `common/Cart`
- This prefix allows disambiguating same-name icons in different subdirectories (e.g., `ui/arrow.svg` vs `payment/arrow.svg`)
- If the pattern has **no capture group**, icon names are used as-is without a prefix
- `type` imports are automatically excluded
- Aliases (`import { Cart as MyCart }`) use the original name (`Cart`), not the alias

### All Options

```ts
interface SpritePluginOptions {
  // Path to the folder containing source SVG files.
  // Scanned recursively — subdirectories are supported.
  iconsDir: string;

  // Folders to scan for icon usage in your source code.
  // node_modules, dist, build, .git are excluded automatically.
  sourceDirs: string[];

  // Regex to detect icon imports. Applied to the module specifier.
  // Must have one capture group for the icon name.
  importPattern: RegExp;

  // Where to write the generated sprite file.
  // Directory is created automatically if it doesn't exist.
  output: string;

  // Extract icon names from import specifiers instead of module paths.
  // When enabled, `import { Cart } from '@ui/icons/common'` extracts "Cart".
  // If importPattern has a capture group, it's used as a category prefix
  // (e.g., "common/Cart"). Default: false
  extractNamedImports?: boolean;

  // File extensions to scan. Default: ['.ts', '.tsx', '.js', '.jsx']
  extensions?: string[];

  // Print detailed logs during generation. Default: false
  verbose?: boolean;

  // Don't generate a file if no icons are found. Default: false
  skipIfEmpty?: boolean;
}
```

### Icon Name Matching

The plugin matches icon names to SVG filenames in `iconsDir` using multiple strategies:

**Basic matching** (case-insensitive):
```
"cart"     → cart.svg
"CartIcon" → cart-icon.svg (PascalCase → kebab-case)
```

**Path-based matching** (with `extractNamedImports` and a capture group):
```
icons/
├── ui/
│   └── arrow.svg      ← matched by "ui/Arrow"
├── payment/
│   └── arrow.svg      ← matched by "payment/Arrow"
├── cart.svg            ← matched by "cart"
└── search.svg          ← matched by "search"
```

When icons have the same filename in different subdirectories, the category prefix from the capture group disambiguates them. Each icon gets a unique symbol ID in the sprite (`id="ui/arrow"`, `id="payment/arrow"`).

**Without a prefix**, the plugin falls back to basename matching. If multiple files share the same name, the last one found wins — use prefixes to avoid ambiguity.

If an icon is imported but no matching SVG file exists, the plugin logs a warning and continues — it won't break your build.

## What Gets Optimized

Every SVG goes through [SVGO](https://github.com/svg/svgo) and additional processing:

| Before | After |
|--------|-------|
| Editor metadata (Figma, Sketch, Illustrator) | Removed |
| `width` and `height` attributes | Removed (uses `viewBox` instead) |
| XML namespaces, doctype, comments | Removed |
| `fill="#000000"`, `fill="#000"`, `fill="black"` | `fill="currentColor"` |
| `fill="rgb(0,0,0)"`, `rgba(0,0,0,1)` | `fill="currentColor"` |
| Colors inside `<style>` blocks | Also replaced with `currentColor` |
| Redundant groups, empty elements | Removed |
| Path data | Minified |

The `currentColor` replacement means your icons automatically inherit the text color of their parent element. Set `color: red` on the parent — the icon turns red.

## Import Styles Detected

The analyzer finds icons across all common import patterns:

```ts
// Static imports
import { CartIcon } from '@ui/icons/cart';
import CartIcon from '@ui/icons/cart';
import * as CartIcon from '@ui/icons/cart';

// Type imports (TypeScript) — ignored, not real usage
import type { CartIcon } from '@ui/icons/cart';

// Re-exports
export { CartIcon } from '@ui/icons/cart';

// Dynamic imports
const CartIcon = await import('@ui/icons/cart');
import('@ui/icons/cart').then(/* ... */);

// CommonJS
const CartIcon = require('@ui/icons/cart');

// Multiline
import {
  CartIcon,
  SearchIcon,
} from '@ui/icons/cart';
```

With `extractNamedImports: true`, the analyzer also extracts individual names from destructured imports:

```ts
// Each name becomes a separate icon
import { Cart, Search, Star } from '@ui/Icon/common';
// → icons: common/Cart, common/Search, common/Star

// Aliases use the original name
import { Cart as MyCart } from '@ui/Icon/common';
// → icon: common/Cart (not MyCart)

// Type imports are excluded
import { type CartProps, Cart } from '@ui/Icon/common';
// → icon: common/Cart (CartProps is skipped)
```

Imports inside comments (`//` and `/* */`) are correctly ignored.

## SSR Compatibility

The generated `injectSprite()` function is safe to call during server-side rendering — it checks for `document` before doing anything:

```ts
export function injectSprite(): void {
  if (injected || typeof document === 'undefined') return;
  // ...
}
```

Multiple calls are also safe — the sprite is injected only once.

## Programmatic API

For advanced use cases, the analyzer and generator can be used independently:

```ts
import { analyzeImports, generateSprite } from '@mf-toolkit/sprite-plugin';

// Step 1: Find which icons are used
const usages = await analyzeImports({
  sourceDirs: ['./src'],
  importPattern: /@ui\/Icon\/(.+)/,
  extractNamedImports: true,
});

console.log(`Found ${usages.length} icons:`);
for (const usage of usages) {
  console.log(`  ${usage.name} ← ${usage.source}:${usage.line}`);
}
// Output: common/Cart ← src/app.tsx:3
//         ui/Arrow    ← src/nav.tsx:1

// Step 2: Generate the sprite (or do something else with the list)
await generateSprite({
  iconsDir: './src/assets/icons',
  sourceDirs: ['./src'],
  importPattern: /@ui\/Icon\/(.+)/,
  extractNamedImports: true,
  output: './src/generated/sprite.ts',
  verbose: true,
});
```

## License

MIT
