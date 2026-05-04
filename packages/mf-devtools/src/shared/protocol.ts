/**
 * Wire protocol shared by every layer:
 *   page world (hook) → ISOLATED content script → background → devtools panel
 *
 * Must stay JSON-serializable end-to-end (postMessage + chrome.runtime
 * structured-clone) — no functions, no DOM nodes, no Symbols.
 */

export type MFMode =
  | 'bridge'
  | 'lazy'
  | 'hydrated'
  | 'ssr-url'
  | 'ssr-loader'
  | 'remote-entry'
  | 'remote-define-entry'
  | 'remote-hydrate'

export type MFEvent =
  | {
      kind: 'mount'
      id: string
      pkg: 'bridge' | 'ssr'
      namespace: string
      mode: MFMode
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

/** Marker on every window.postMessage we own, used for source-checking. */
export const MF_PAGE_MESSAGE = '__MF_DEVTOOLS_PAGE__' as const

/** Wrapper sent from page world (hook) → ISOLATED content script. */
export interface PageMessage {
  source: typeof MF_PAGE_MESSAGE
  events: MFEvent[]
}

/** Messages on the chrome.runtime channel between content script ↔ background ↔ panel. */
export type RuntimeMessage =
  | { type: 'mf-events'; tabId: number; events: MFEvent[] }
  | { type: 'mf-panel-ready'; tabId: number }
  | { type: 'mf-clear'; tabId: number }
