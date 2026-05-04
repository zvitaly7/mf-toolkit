/**
 * Runs in the ISOLATED world. Listens for `window.postMessage` events from
 * the page-world hook (hook-installer.ts) and forwards batches to the
 * extension's service worker, which routes them to the open devtools panel.
 */

import {
  MF_PAGE_MESSAGE,
  type MFEvent,
  type PageMessage,
  type RuntimeMessage,
} from '../shared/protocol.js'

// Buffer events that arrive before any panel is listening so the panel still
// sees mounts that happened during page load.
let buffer: MFEvent[] = []
const MAX_BUFFER = 1000

function isPageMessage(data: unknown): data is PageMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === MF_PAGE_MESSAGE &&
    Array.isArray((data as { events?: unknown }).events)
  )
}

window.addEventListener('message', (e) => {
  if (e.source !== window) return
  if (!isPageMessage(e.data)) return
  const events = e.data.events
  buffer.push(...events)
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER)
  void chrome.runtime
    .sendMessage<RuntimeMessage>({ type: 'mf-events', tabId: -1, events })
    .catch(() => {
      // No receiver yet (panel not opened) — events stay in buffer.
    })
})

// Panel opens / reloads → flush whatever we've buffered so far.
chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  if (msg.type === 'mf-panel-ready') {
    const events = buffer
    buffer = []
    sendResponse({ events })
    return true
  }
  if (msg.type === 'mf-clear') {
    buffer = []
    sendResponse({ ok: true })
    return true
  }
  return false
})
