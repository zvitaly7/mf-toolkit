/**
 * @internal
 *
 * Dev-only emitter for `@mf-toolkit/mf-devtools` (the Chrome extension).
 *
 * Every call site is wrapped at the consumer's bundler in
 * `if (process.env.NODE_ENV !== 'production')`, so this entire module is
 * dead-code-eliminated from production builds.
 *
 * The hook lives at `globalThis.__MF_DEVTOOLS_HOOK__`, installed in the page's
 * MAIN world by the extension's content script before the user's bundle runs.
 * If no extension is installed, every call is a single property read + falsy
 * check — zero allocations, no listeners.
 */

export type MFDevtoolsMode =
  | 'bridge'
  | 'lazy'
  | 'hydrated'
  | 'ssr-url'
  | 'ssr-loader'
  | 'remote-entry'
  | 'remote-define-entry'
  | 'remote-hydrate'

export type MFDevtoolsEvent =
  | {
      kind: 'mount'
      id: string
      pkg: 'bridge' | 'ssr'
      namespace: string
      mode: MFDevtoolsMode
      ts: number
      props?: unknown
      url?: string
      shadowDom?: boolean
    }
  | { kind: 'unmount'; id: string; ts: number }
  | { kind: 'props'; id: string; ts: number; props: unknown }
  | {
      kind: 'event'
      id: string
      ts: number
      type: string
      payload: unknown
      direction: 'remote->host' | 'host->remote'
    }
  | {
      kind: 'load'
      id: string
      ts: number
      phase: 'start' | 'ok' | 'retry' | 'error'
      attempt?: number
      error?: string
    }
  | {
      kind: 'fetch'
      id: string
      ts: number
      phase: 'start' | 'ok' | 'retry' | 'error'
      url: string
      attempt?: number
      error?: string
    }

interface MFDevtoolsHook {
  v: 1
  emit(event: MFDevtoolsEvent): void
}

// Bundlers (Vite, Webpack, esbuild) replace `process.env.NODE_ENV` with the
// literal "production" string in production builds, so the early-return below
// becomes statically true and the function body is dead-code-eliminated.
declare const process: { env: { NODE_ENV?: string } }

let _devtoolsId = 0

/** Returns a fresh id for a new mounted instance. Stable across the same mount's lifetime. */
export function nextDevtoolsId(): string {
  return `bridge-${++_devtoolsId}`
}

function getHook(): MFDevtoolsHook | undefined {
  const g = globalThis as { __MF_DEVTOOLS_HOOK__?: MFDevtoolsHook }
  const hook = g.__MF_DEVTOOLS_HOOK__
  return hook && hook.v === 1 ? hook : undefined
}

export function emitDev(event: MFDevtoolsEvent): void {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return
  try {
    getHook()?.emit(event)
  } catch {
    // Never let devtools instrumentation break the host.
  }
}
