import type { SpritePluginOptions } from '../types.js';
import { generateSprite } from '../generator/generate-sprite.js';

interface Compiler {
  hooks: {
    beforeCompile: {
      tapPromise(name: string, callback: (params: unknown) => Promise<void>): void;
    };
    watchRun: {
      tapPromise(name: string, callback: (compiler: unknown) => Promise<void>): void;
    };
  };
}

const PLUGIN_NAME = 'MfSpritePlugin';

/**
 * Webpack plugin that generates an optimized SVG sprite before compilation.
 * Runs on both initial build and watch-mode rebuilds.
 *
 * @example
 * ```js
 * const { MfSpriteWebpackPlugin } = require('@mf-toolkit/sprite-plugin/webpack');
 *
 * module.exports = {
 *   plugins: [
 *     new MfSpriteWebpackPlugin({
 *       iconsDir: './src/assets/icons',
 *       sourceDirs: ['./src'],
 *       importPattern: /@my-ui\/icons\/(.+)/,
 *       output: './src/generated/sprite.ts',
 *     }),
 *   ],
 * };
 * ```
 */
export class MfSpriteWebpackPlugin {
  private options: SpritePluginOptions;

  constructor(options: SpritePluginOptions) {
    this.options = options;
  }

  apply(compiler: Compiler): void {
    const run = async () => {
      try {
        await generateSprite(this.options);
      } catch (error) {
        console.warn(`[${PLUGIN_NAME}] Sprite generation failed:`, error);
      }
    };

    // Run before initial compilation
    compiler.hooks.beforeCompile.tapPromise(PLUGIN_NAME, run);

    // Re-run on watch mode rebuilds
    compiler.hooks.watchRun.tapPromise(PLUGIN_NAME, run);
  }
}
