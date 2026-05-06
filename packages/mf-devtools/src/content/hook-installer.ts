/**
 * Runs in the page's MAIN world at document_start, BEFORE the user's bundle
 * loads. Installs `window.__MF_DEVTOOLS_HOOK__` so that mf-bridge / mf-ssr
 * — when they call `emitDev(...)` — push events into our queue.
 *
 * Events are batched and posted via `window.postMessage` to the ISOLATED-world
 * content script (content-bridge.ts) for forwarding to the devtools panel.
 *
 * If the page never opens devtools, the queue still fills harmlessly; the
 * isolated bridge picks events up as soon as a panel subscribes.
 */

import {
  MF_PAGE_MESSAGE,
  type FederationRemoteHint,
  type MFEvent,
  type PageMessage,
} from '../shared/protocol.js'

declare global {
  interface Window {
    __MF_DEVTOOLS_HOOK__?: { v: 1; emit(event: MFEvent): void }
    /**
     * Module Federation 2.0 runtime registers itself here. Schema is loose —
     * we only read the bits we need (instances, share scope) and serialise
     * them defensively.
     */
    __FEDERATION__?: unknown
  }
}

// Already installed (e.g. duplicate injection on SPA navigation) — bail.
if (!window.__MF_DEVTOOLS_HOOK__) {
  let queue: MFEvent[] = []
  let scheduled = false

  function flush(): void {
    if (queue.length === 0) {
      scheduled = false
      return
    }
    const batch = queue
    queue = []
    scheduled = false
    const payload: PageMessage = { source: MF_PAGE_MESSAGE, events: batch.map(safe) }
    try {
      window.postMessage(payload, window.location.origin)
    } catch {
      // postMessage failed (e.g. opaque origin) — drop silently.
    }
  }

  function schedule(): void {
    if (scheduled) return
    scheduled = true
    // Coalesce bursts (prop streaming on every keystroke, etc.).
    queueMicrotask(flush)
  }

  /**
   * Strip non-cloneable values (functions, DOM nodes, circular refs) so
   * postMessage's structured-clone never throws and devtools shows a
   * meaningful placeholder instead.
   */
  function safe<E extends MFEvent>(event: E): E {
    if ('props' in event && event.props !== undefined) {
      return { ...event, props: serialize(event.props, new WeakSet()) } as E
    }
    if (event.kind === 'event' && event.payload !== undefined) {
      return { ...event, payload: serialize(event.payload, new WeakSet()) } as E
    }
    return event
  }

  function serialize(value: unknown, seen: WeakSet<object>): unknown {
    if (value === null || value === undefined) return value
    const t = typeof value
    if (t === 'string' || t === 'number' || t === 'boolean') return value
    if (t === 'function') return `[Function ${(value as Function).name || 'anonymous'}]`
    if (t === 'symbol') return String(value)
    if (t === 'bigint') return `${(value as bigint).toString()}n`
    if (typeof Node !== 'undefined' && value instanceof Node) {
      const n = value as Node
      const tag = (n as Element).tagName?.toLowerCase?.() ?? n.nodeName.toLowerCase()
      return `[Node <${tag}>]`
    }
    if (typeof Element !== 'undefined' && value instanceof Element) {
      return `[Element <${value.tagName.toLowerCase()}>]`
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
      return value.map((v) => serialize(v, seen))
    }
    if (t === 'object') {
      if (seen.has(value as object)) return '[Circular]'
      seen.add(value as object)
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(value as Record<string, unknown>)) {
        try {
          out[key] = serialize((value as Record<string, unknown>)[key], seen)
        } catch {
          out[key] = '[Unserializable]'
        }
      }
      return out
    }
    return String(value)
  }

  window.__MF_DEVTOOLS_HOOK__ = {
    v: 1,
    emit(event: MFEvent): void {
      queue.push(event)
      schedule()
    },
  }

  // ─── Federation snapshot poller ────────────────────────────────────────────
  //
  // Module Federation 2.0 sets `window.__FEDERATION__` after its runtime
  // initialises — there is no event we can subscribe to, so we poll for a
  // bounded window after document_start. Once the global appears (and changes
  // shape, e.g. additional remotes load lazily), we emit a `federation` event
  // with a digest of the remotes the panel can use to fetch mf-manifest.json
  // for each.
  //
  // For pages without MF 2.0, `__FEDERATION__` never shows up — the poller
  // exhausts its budget and the audit tab falls back to manual upload.

  let lastSerialized = ''
  let polls = 0
  const MAX_POLLS = 30
  const POLL_INTERVAL_MS = 500

  function snapshotFederation(): void {
    const fed = window.__FEDERATION__
    if (!fed || typeof fed !== 'object') return

    const instances = (fed as { __INSTANCES__?: unknown }).__INSTANCES__
    if (!Array.isArray(instances)) return

    const remotes: FederationRemoteHint[] = []
    for (const inst of instances) {
      if (!inst || typeof inst !== 'object') continue
      const i = inst as Record<string, unknown>
      const hint: FederationRemoteHint = {}
      if (typeof i.name === 'string') hint.name = i.name
      if (typeof i.version === 'string') hint.version = i.version
      // MF 2.0 tracks options.remoteEntry / moduleCache; flatten common shapes.
      const opts = i.options as Record<string, unknown> | undefined
      const remoteEntry =
        (typeof i.remoteEntry === 'string' && i.remoteEntry) ||
        (opts && typeof opts.remoteEntry === 'string' && opts.remoteEntry) ||
        undefined
      if (remoteEntry) hint.remoteEntry = remoteEntry
      const manifestUrl =
        (typeof i.manifestUrl === 'string' && i.manifestUrl) ||
        (opts && typeof opts.manifestUrl === 'string' && opts.manifestUrl) ||
        undefined
      if (manifestUrl) hint.manifestUrl = manifestUrl
      if (hint.name || hint.remoteEntry || hint.manifestUrl) remotes.push(hint)
    }

    const serialized = JSON.stringify(remotes)
    if (serialized === lastSerialized) return
    lastSerialized = serialized
    queue.push({ kind: 'federation', ts: Date.now(), remotes })
    schedule()
  }

  const pollId = setInterval(() => {
    polls++
    snapshotFederation()
    if (polls >= MAX_POLLS) clearInterval(pollId)
  }, POLL_INTERVAL_MS)
  // First check immediately so single-shot MF setups don't wait 500ms.
  snapshotFederation()
}
