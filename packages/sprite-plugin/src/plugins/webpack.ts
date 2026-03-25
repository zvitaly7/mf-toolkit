import type { SpritePluginOptions } from '../types.js';
import { generateSprite } from '../generator/generate-sprite.js';

interface Compiler {
  hooks: {
    beforeCompile: {
      tapAsync(name: string, callback: (params: unknown, done: () => void) => void): void;
    };
  };
}

export class MfSpriteWebpackPlugin {
  private options: SpritePluginOptions;

  constructor(options: SpritePluginOptions) {
    this.options = options;
  }

  apply(compiler: Compiler): void {
    compiler.hooks.beforeCompile.tapAsync('MfSpritePlugin', (_params, done) => {
      try {
        generateSprite(this.options);
      } catch (error) {
        console.warn('[MfSpritePlugin] Sprite generation failed:', error);
      }
      done();
    });
  }
}
