import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpritePluginOptions } from '../types.js';
import { generateSprite } from '../generator/generate-sprite.js';

interface PluginContext {
  addWatchFile(id: string): void;
}

interface RollupPlugin {
  name: string;
  buildStart(this: PluginContext): Promise<void>;
  watchChange(id: string): Promise<void>;
}

const PLUGIN_NAME = 'mf-sprite';

/**
 * Rollup plugin that generates an optimized SVG sprite before bundling.
 * Runs on both initial build and watch-mode rebuilds.
 *
 * @example
 * ```js
 * // rollup.config.js
 * import { mfSpriteRollupPlugin } from '@mf-toolkit/sprite-plugin/rollup';
 *
 * export default {
 *   plugins: [
 *     mfSpriteRollupPlugin({
 *       iconsDir: './src/assets/icons',
 *       sourceDirs: ['./src'],
 *       importPattern: /@my-ui\/icons\/(.+)/,
 *       output: './src/generated/sprite.ts',
 *     }),
 *   ],
 * };
 * ```
 */
export function mfSpriteRollupPlugin(options: SpritePluginOptions): RollupPlugin {
  const run = async () => {
    try {
      await generateSprite(options);
    } catch (error) {
      console.warn(`[${PLUGIN_NAME}] Sprite generation failed:`, error);
    }
  };

  return {
    name: PLUGIN_NAME,

    async buildStart(this: PluginContext) {
      // Register SVG files with Rollup's watcher so watchChange fires when they change.
      // Without this, Rollup only watches files in the module graph — SVG files read
      // directly via fs.readFile would never trigger a rebuild.
      try {
        const entries = await readdir(options.iconsDir, { recursive: true });
        for (const entry of entries) {
          if (typeof entry === 'string' && entry.endsWith('.svg')) {
            this.addWatchFile(join(options.iconsDir, entry));
          }
        }
      } catch {
        // iconsDir may not exist yet on first run — ignore
      }

      await run();
    },

    async watchChange(id: string) {
      const { iconsDir, sourceDirs } = options;
      const normalizedId = id.replace(/\\/g, '/');

      const isRelevant =
        normalizedId.startsWith(iconsDir.replace(/\\/g, '/')) ||
        sourceDirs.some((dir) => normalizedId.startsWith(dir.replace(/\\/g, '/')));

      if (isRelevant) {
        await run();
      }
    },
  };
}
