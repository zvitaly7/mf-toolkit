import type { SpritePluginOptions } from '../types.js';
import { mfSpriteRollupPlugin } from './rollup.js';

interface VitePlugin {
  name: string;
  buildStart(): Promise<void>;
  watchChange(id: string): Promise<void>;
  handleHotUpdate(ctx: { file: string }): Promise<void>;
}

/**
 * Vite plugin that generates an optimized SVG sprite before bundling.
 * Extends the Rollup plugin with HMR support via handleHotUpdate.
 *
 * @example
 * ```js
 * // vite.config.js
 * import { mfSpriteVitePlugin } from '@mf-toolkit/sprite-plugin/vite';
 *
 * export default {
 *   plugins: [
 *     mfSpriteVitePlugin({
 *       iconsDir: './src/assets/icons',
 *       sourceDirs: ['./src'],
 *       importPattern: /@my-ui\/icons\/(.+)/,
 *       output: './src/generated/sprite.ts',
 *     }),
 *   ],
 * };
 * ```
 */
export function mfSpriteVitePlugin(options: SpritePluginOptions): VitePlugin {
  const rollup = mfSpriteRollupPlugin(options);

  return {
    ...rollup,
    name: 'mf-sprite-vite',

    async handleHotUpdate({ file }: { file: string }) {
      await rollup.watchChange(file);
    },
  };
}
