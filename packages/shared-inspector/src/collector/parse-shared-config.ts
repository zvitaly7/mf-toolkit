import type { SharedDepConfig } from '../types.js';

/**
 * Module Federation accepts shared config in multiple formats:
 *
 *   string[]                              → ['react', 'react-dom']
 *   Record<string, SharedDepConfig>       → { react: { singleton: true } }
 *   Array<string | Record<...>>           → [{ react: { singleton: true } }, 'lodash']
 *
 * This function normalises all formats to Record<string, SharedDepConfig>.
 */
export function parseSharedConfig(
  raw: unknown,
): Record<string, SharedDepConfig> {
  if (!raw) return {};

  // Object format: { react: { singleton: true }, lodash: {} }
  if (isPlainObject(raw)) {
    return normaliseObjectConfig(raw as Record<string, unknown>);
  }

  // Array format: string[] | Array<string | Record<...>>
  if (Array.isArray(raw)) {
    const result: Record<string, SharedDepConfig> = {};
    for (const item of raw) {
      if (typeof item === 'string') {
        result[item] = {};
      } else if (isPlainObject(item)) {
        Object.assign(result, normaliseObjectConfig(item as Record<string, unknown>));
      }
    }
    return result;
  }

  return {};
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normaliseObjectConfig(
  obj: Record<string, unknown>,
): Record<string, SharedDepConfig> {
  const result: Record<string, SharedDepConfig> = {};

  for (const [pkg, config] of Object.entries(obj)) {
    if (!isPlainObject(config) && config !== undefined) {
      // Unexpected value — treat package as present with empty config
      result[pkg] = {};
      continue;
    }

    const cfg = (config ?? {}) as Record<string, unknown>;
    const normalised: SharedDepConfig = {};

    if (typeof cfg['singleton'] === 'boolean') normalised.singleton = cfg['singleton'];
    if (typeof cfg['eager'] === 'boolean') normalised.eager = cfg['eager'];
    if (typeof cfg['requiredVersion'] === 'string') normalised.requiredVersion = cfg['requiredVersion'];

    result[pkg] = normalised;
  }

  return result;
}
