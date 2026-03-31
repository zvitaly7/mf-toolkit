// ─── Diagnostics knowledge base ──────────────────────────────────────────────
//
// Maps (package, issue-kind) → { risk description, fix snippet hint }.
// Used by formatReport / formatFederationReport to produce actionable output.

export interface DiagnosticInfo {
  /** One-line risk description shown after "→ Risk:" */
  risk: string;
}

export type IssueKind =
  | 'mismatch'
  | 'unused'
  | 'candidate'
  | 'singleton-risk'
  | 'eager-risk';

// ─── Per-package knowledge ────────────────────────────────────────────────────

const PACKAGE_DIAGNOSTICS: Record<string, Partial<Record<IssueKind, string>>> = {
  react: {
    mismatch:        'Invalid hook call, broken context across MFs',
    candidate:       'Multiple React copies → invalid hook call',
    'singleton-risk': 'Multiple React instances → invalid hook call, broken context',
    'eager-risk':    'Duplicate React before negotiation completes → invalid hook call',
    unused:          'React is consumed by JSX transform — removing may break JSX in remotes',
  },
  'react-dom': {
    mismatch:        'Rendering broken — host and remote use different ReactDOM',
    candidate:       'Multiple ReactDOM copies → broken rendering',
    'singleton-risk': 'Multiple ReactDOM instances → broken rendering, portals fail',
    unused:          'ReactDOM is consumed implicitly — removing may break renders in remotes',
  },
  'react-router': {
    mismatch:        'Router version mismatch → broken navigation, hooks (useParams, useNavigate) broken',
    candidate:       'Each MF has its own router instance → history state conflicts',
    'singleton-risk': 'Multiple router instances → navigation conflicts between MFs',
    unused:          'Route declarations in the remote may silently stop working',
  },
  'react-router-dom': {
    mismatch:        'Router version mismatch → broken navigation',
    candidate:       'Each MF has its own router → useNavigate / useParams broken cross-MF',
    'singleton-risk': 'Multiple router instances → useNavigate / useParams broken',
    unused:          'Link and Route components may stop working in other MFs',
  },
  mobx: {
    mismatch:        'Observable state won\'t sync — MFs run different MobX versions',
    candidate:       'Each MF gets its own MobX — observables and reactions won\'t sync between MFs',
    'singleton-risk': 'Multiple MobX instances → cross-MF reactions won\'t fire, state isolated',
    unused:          'MobX stores in the remote will be untracked',
  },
  'mobx-react': {
    mismatch:        'observer() wraps components from different MobX instances',
    candidate:       'Multiple mobx-react copies → observer() connects to wrong store instance',
    'singleton-risk': 'Multiple mobx-react instances → observer() binds to isolated store',
  },
  'mobx-react-lite': {
    mismatch:        'useObserver connects to wrong MobX instance',
    candidate:       'Each MF gets its own observer binding',
    'singleton-risk': 'Multiple mobx-react-lite → useObserver connects to wrong store',
  },
  redux: {
    mismatch:        'Redux version mismatch → dispatch / subscribe API incompatible',
    candidate:       'Each MF creates its own store — actions won\'t propagate across MFs',
    'singleton-risk': 'Multiple Redux stores → dispatches won\'t propagate cross-MF',
  },
  '@reduxjs/toolkit': {
    mismatch:        'RTK version mismatch → createSlice / createAsyncThunk API differences',
    candidate:       'Each MF bundles its own RTK — separate store instances, no shared state',
    'singleton-risk': 'Multiple RTK instances → slices belong to different stores',
  },
  zustand: {
    mismatch:        'Zustand API mismatch → store subscriptions may not work correctly',
    candidate:       'Each MF gets its own Zustand store — state not shared across MFs',
    'singleton-risk': 'Multiple Zustand instances → store subscriptions not shared',
  },
  jotai: {
    candidate:       'Each MF gets its own Jotai atom scope — atoms won\'t sync',
    'singleton-risk': 'Multiple Jotai instances → atoms not shared between MFs',
  },
  recoil: {
    candidate:       'Each MF gets its own Recoil root — atoms isolated per MF',
    'singleton-risk': 'Multiple Recoil instances → RecoilRoot state not shared',
  },
  vue: {
    mismatch:        'Vue runtime mismatch → app.use() and composables broken',
    candidate:       'Each MF bundles Vue — composables won\'t share reactive state',
    'singleton-risk': 'Multiple Vue runtimes → provide/inject across MFs broken',
  },
  'vue-router': {
    mismatch:        'Router version mismatch → navigation guards and hooks broken',
    candidate:       'Each MF has its own Vue Router instance → navigation conflicts',
    'singleton-risk': 'Multiple router instances → useRoute / useRouter broken cross-MF',
  },
  'styled-components': {
    mismatch:        'Style injection broken — className collisions between MFs',
    candidate:       'Each MF bundles its own styled-components — class name conflicts in SSR',
    'singleton-risk': 'Multiple styled-components → theme context not shared, class collisions',
  },
  '@emotion/react': {
    mismatch:        'Emotion cache mismatch → styles not injected correctly across MFs',
    candidate:       'Each MF has its own Emotion cache — styles may conflict or duplicate',
    'singleton-risk': 'Multiple Emotion instances → theme context not shared, styles broken',
  },
  '@emotion/styled': {
    mismatch:        'Emotion version mismatch → styled components lose theme context',
    candidate:       'Each MF bundles @emotion/styled independently',
    'singleton-risk': 'Multiple Emotion instances → styled components lose theme context',
  },
  '@tanstack/react-query': {
    candidate:       'Each MF has its own QueryClient → no shared cache, duplicate requests',
    'singleton-risk': 'Multiple QueryClient instances → cache not shared between MFs',
  },
  swr: {
    candidate:       'Each MF has its own SWR cache → duplicate fetches, no deduplication',
    'singleton-risk': 'Multiple SWR instances → cache not shared between MFs',
  },
};

// ─── Generic fallbacks ────────────────────────────────────────────────────────

const GENERIC_RISK: Record<IssueKind, string> = {
  mismatch:        'Version mismatch may cause runtime errors or silent incompatibilities',
  unused:          'Wastes bundle negotiation overhead with no import benefit',
  candidate:       'Each MF bundles its own copy — larger bundles, possible state desync',
  'singleton-risk': 'Duplicate instances may cause unexpected runtime behavior',
  'eager-risk':    'Eager loading without singleton risks duplicate instances during negotiation',
};

export function getDiagnostic(pkg: string, kind: IssueKind): DiagnosticInfo {
  const risk = PACKAGE_DIAGNOSTICS[pkg]?.[kind] ?? GENERIC_RISK[kind];
  return { risk };
}

// ─── Fix snippet builder ──────────────────────────────────────────────────────

export interface FixConfig {
  singleton?: boolean;
  requiredVersion?: string;
  eager?: boolean;
}

/**
 * Returns a ready-to-paste webpack/rspack shared config snippet.
 *
 * @example
 * buildFixSnippet('react', { singleton: true, requiredVersion: '^18.2.0' })
 * // →
 * // shared: {
 * //   react: { singleton: true, requiredVersion: "^18.2.0" }
 * // }
 */
export function buildFixSnippet(pkg: string, cfg: FixConfig = {}): string {
  const entries: string[] = [];
  if (cfg.singleton) entries.push('singleton: true');
  if (cfg.requiredVersion) entries.push(`requiredVersion: "${cfg.requiredVersion}"`);
  if (cfg.eager) entries.push('eager: true');

  const inner = entries.length > 0 ? ` { ${entries.join(', ')} }` : ' {}';
  return `shared: {\n  ${pkg}:${inner}\n}`;
}
