/**
 * Service worker. Routes events from the per-tab content scripts to whichever
 * devtools panel is open for that tab. The panel keeps a long-lived port
 * (`mf-devtools:<tabId>`) so the worker can fan event batches to it directly.
 */

import type { RuntimeMessage } from '../shared/protocol.js'

const ports = new Map<number, chrome.runtime.Port>()

chrome.runtime.onConnect.addListener((port) => {
  const match = /^mf-devtools:(\d+)$/.exec(port.name)
  if (!match) return
  const tabId = Number(match[1])
  ports.set(tabId, port)
  port.onDisconnect.addListener(() => {
    if (ports.get(tabId) === port) ports.delete(tabId)
  })
})

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender) => {
  if (msg.type !== 'mf-events') return false
  const tabId = sender.tab?.id
  if (typeof tabId !== 'number') return false
  const port = ports.get(tabId)
  if (!port) return false
  try {
    port.postMessage({ type: 'mf-events', tabId, events: msg.events } satisfies RuntimeMessage)
  } catch {
    ports.delete(tabId)
  }
  return false
})
