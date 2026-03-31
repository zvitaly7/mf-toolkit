import { describe, it, expect } from 'vitest';
import { extractSharedFromCompiler } from '../../src/collector/extract-mfp-shared.js';

// ─── Fake compiler factory ────────────────────────────────────────────────────

function makeCompiler(plugins: unknown[]) {
  return { options: { plugins } };
}

class ModuleFederationPlugin {
  _options: unknown;
  constructor(options: unknown) { this._options = options; }
}

class ModuleFederationPluginV2 {
  _options: unknown;
  constructor(options: unknown) { this._options = options; }
}

class OtherPlugin {}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('extractSharedFromCompiler', () => {
  it('returns null when no plugins array', () => {
    expect(extractSharedFromCompiler({})).toBeNull();
    expect(extractSharedFromCompiler({ options: {} })).toBeNull();
    expect(extractSharedFromCompiler(null)).toBeNull();
  });

  it('returns null when no ModuleFederationPlugin in plugins', () => {
    const compiler = makeCompiler([new OtherPlugin()]);
    expect(extractSharedFromCompiler(compiler)).toBeNull();
  });

  it('returns null when MFP has no shared option', () => {
    const compiler = makeCompiler([new ModuleFederationPlugin({})]);
    expect(extractSharedFromCompiler(compiler)).toBeNull();
  });

  it('extracts object-format shared config', () => {
    const compiler = makeCompiler([
      new ModuleFederationPlugin({
        shared: { react: { singleton: true, requiredVersion: '^18.0.0' }, lodash: {} },
      }),
    ]);
    const result = extractSharedFromCompiler(compiler);
    expect(result).toEqual({
      react: { singleton: true, requiredVersion: '^18.0.0' },
      lodash: {},
    });
  });

  it('extracts array-format shared config', () => {
    const compiler = makeCompiler([
      new ModuleFederationPlugin({ shared: ['react', 'react-dom'] }),
    ]);
    const result = extractSharedFromCompiler(compiler);
    expect(result).toEqual({ react: {}, 'react-dom': {} });
  });

  it('extracts mixed array-format shared config', () => {
    const compiler = makeCompiler([
      new ModuleFederationPlugin({
        shared: ['lodash', { react: { singleton: true } }],
      }),
    ]);
    const result = extractSharedFromCompiler(compiler);
    expect(result).toEqual({ lodash: {}, react: { singleton: true } });
  });

  it('returns null when shared resolves to empty object', () => {
    const compiler = makeCompiler([
      new ModuleFederationPlugin({ shared: [] }),
    ]);
    expect(extractSharedFromCompiler(compiler)).toBeNull();
  });

  it('supports ModuleFederationPluginV2 constructor name', () => {
    const compiler = makeCompiler([
      new ModuleFederationPluginV2({ shared: { react: { singleton: true } } }),
    ]);
    const result = extractSharedFromCompiler(compiler);
    expect(result).toEqual({ react: { singleton: true } });
  });

  it('falls back to .options.shared when ._options is absent', () => {
    const plugin = { constructor: { name: 'ModuleFederationPlugin' }, options: { shared: { vue: {} } } };
    const compiler = makeCompiler([plugin]);
    const result = extractSharedFromCompiler(compiler);
    expect(result).toEqual({ vue: {} });
  });

  it('uses first MFP found when multiple plugins present', () => {
    const compiler = makeCompiler([
      new OtherPlugin(),
      new ModuleFederationPlugin({ shared: { react: { singleton: true } } }),
      new OtherPlugin(),
    ]);
    const result = extractSharedFromCompiler(compiler);
    expect(result).toEqual({ react: { singleton: true } });
  });

  it('strips unknown fields — only passes singleton, eager, requiredVersion', () => {
    const compiler = makeCompiler([
      new ModuleFederationPlugin({
        shared: { react: { singleton: true, version: '18.0.0', someUnknown: true } },
      }),
    ]);
    const result = extractSharedFromCompiler(compiler);
    expect(result).toEqual({ react: { singleton: true } });
    expect(result!['react']).not.toHaveProperty('version');
    expect(result!['react']).not.toHaveProperty('someUnknown');
  });
});
