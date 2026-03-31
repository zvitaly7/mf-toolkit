import { parseSharedConfig } from './parse-shared-config.js';
import type { SharedDepConfig } from '../types.js';

/**
 * Known constructor names for Module Federation plugins across bundlers.
 * Checked by name to avoid a hard runtime dependency on webpack/rspack.
 */
const MFP_CONSTRUCTOR_NAMES = new Set([
  'ModuleFederationPlugin',       // webpack 5
  'ModuleFederationPluginV2',     // some community forks
]);

/**
 * Tries to extract the `shared` config from a ModuleFederationPlugin instance
 * found in `compiler.options.plugins`.
 *
 * Returns `null` when:
 * - No ModuleFederationPlugin is found
 * - The plugin exists but has no `shared` option
 * - The plugin uses an unknown internal storage format
 *
 * This intentionally uses `any` to remain independent of webpack/rspack types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractSharedFromCompiler(compiler: any): Record<string, SharedDepConfig> | null {
  const plugins: unknown[] = compiler?.options?.plugins;
  if (!Array.isArray(plugins)) return null;

  const mfPlugin = plugins.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p: any) => p != null && MFP_CONSTRUCTOR_NAMES.has(p.constructor?.name),
  );

  if (!mfPlugin) return null;

  // webpack 5 stores options as `this._options` (private but stable across 5.x)
  // Fall back to `this.options` used by some community variants
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (mfPlugin as any)._options?.shared ?? (mfPlugin as any).options?.shared;

  if (raw == null) return null;

  const parsed = parseSharedConfig(raw);
  return Object.keys(parsed).length > 0 ? parsed : null;
}
