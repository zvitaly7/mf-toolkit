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

import { MF_PAGE_MESSAGE, type MFEvent, type PageMessage } from '../shared/protocol.js'

declare global {
  interface Window {
    __MF_DEVTOOLS_HOOK__?: { v: 1; emit(event: MFEvent): void }
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
}
