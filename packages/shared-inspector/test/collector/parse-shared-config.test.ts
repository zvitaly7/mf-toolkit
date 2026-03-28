import { describe, it, expect } from 'vitest';
import { parseSharedConfig } from '../../src/collector/parse-shared-config.js';

describe('parseSharedConfig — string array', () => {
  it('normalises string array to object with empty configs', () => {
    const result = parseSharedConfig(['react', 'react-dom', 'lodash']);
    expect(result).toEqual({
      react: {},
      'react-dom': {},
      lodash: {},
    });
  });

  it('returns empty object for empty array', () => {
    expect(parseSharedConfig([])).toEqual({});
  });
});

describe('parseSharedConfig — object config', () => {
  it('passes through object config as-is', () => {
    const result = parseSharedConfig({
      react: { singleton: true, requiredVersion: '^19.0.0' },
      lodash: {},
    });
    expect(result).toEqual({
      react: { singleton: true, requiredVersion: '^19.0.0' },
      lodash: {},
    });
  });

  it('preserves singleton flag', () => {
    const result = parseSharedConfig({ mobx: { singleton: true } });
    expect(result['mobx']?.singleton).toBe(true);
  });

  it('preserves eager flag', () => {
    const result = parseSharedConfig({ react: { eager: true } });
    expect(result['react']?.eager).toBe(true);
  });

  it('preserves requiredVersion', () => {
    const result = parseSharedConfig({ react: { requiredVersion: '^19.0.0' } });
    expect(result['react']?.requiredVersion).toBe('^19.0.0');
  });

  it('preserves all three flags together', () => {
    const result = parseSharedConfig({
      react: { singleton: true, eager: true, requiredVersion: '^19.0.0' },
    });
    expect(result['react']).toEqual({
      singleton: true,
      eager: true,
      requiredVersion: '^19.0.0',
    });
  });
});

describe('parseSharedConfig — mixed array', () => {
  it('merges strings and objects from mixed array', () => {
    const result = parseSharedConfig([
      { react: { singleton: true, requiredVersion: '^19.0.0' } },
      'lodash',
      { mobx: { singleton: true } },
    ]);
    expect(result).toEqual({
      react: { singleton: true, requiredVersion: '^19.0.0' },
      lodash: {},
      mobx: { singleton: true },
    });
  });

  it('later entries overwrite earlier ones for the same package', () => {
    const result = parseSharedConfig([
      { react: { singleton: false } },
      { react: { singleton: true } },
    ]);
    expect(result['react']?.singleton).toBe(true);
  });
});

describe('parseSharedConfig — edge cases', () => {
  it('returns empty object for null', () => {
    expect(parseSharedConfig(null)).toEqual({});
  });

  it('returns empty object for undefined', () => {
    expect(parseSharedConfig(undefined)).toEqual({});
  });

  it('returns empty object for unexpected type', () => {
    expect(parseSharedConfig(42)).toEqual({});
  });

  it('handles package with empty config object', () => {
    const result = parseSharedConfig({ lodash: {} });
    expect(result['lodash']).toEqual({});
  });
});
