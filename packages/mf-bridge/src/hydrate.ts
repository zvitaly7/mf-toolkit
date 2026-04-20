import { createElement, type ComponentType } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { DOMEventBus } from './dom-event-bus.js'

export interface HydrateWithBridgeOpts {
  /** Must match the `namespace` passed to `MFBridgeSSR` and `MFBridgeHydrated` on the host. */
  namespace: string
  /** Override the container selector. Default: `[data-mf-namespace="${namespace}"]`. */
  selector?: string
  /** Called when the host sends an imperative command via `commandRef`. */
  onCommand?: (type: string, payload: unknown) => void
}

/**
 * Hydrates a server-rendered MF fragment and sets up the prop-streaming bridge.
 *
 * Call this in the remote's client bundle instead of `hydrateRemote` when the
 * host uses `MFBridgeHydrated` for ongoing prop updates.
 *
 * What it does:
 * 1. Finds the `[data-mf-namespace]` container written by `MFBridgeSSR`.
 * 2. Reads serialized props from the embedded `<script data-mf-props>` tag.
 * 3. Calls `React.hydrateRoot` on the `[data-mf-app]` element.
 * 4. Creates a `DOMEventBus` on the container and listens for `propsChanged`
 *    events dispatched by `MFBridgeHydrated` — calls `root.render()` on each.
 * 5. Listens for `command` events and forwards them to `onCommand` if provided.
 *
 * Returns a teardown function — call it if the fragment is removed from the DOM
 * to clean up all event listeners and unmount the React root.
 *
 * Safe to call in SSR environments — returns a no-op teardown when `document` is undefined.
 */
export function hydrateWithBridge<P extends object>(
  Component: ComponentType<P>,
  opts: HydrateWithBridgeOpts,
): () => void {
  if (typeof document === 'undefined') return () => {}

  const { namespace, selector, onCommand } = opts
  const containerSelector = selector ?? `[data-mf-namespace="${namespace}"]`
  const containers = document.querySelectorAll(containerSelector)

  const teardowns: Array<() => void> = []

  for (const container of containers) {
    const appEl = container.querySelector('[data-mf-app]') as HTMLElement | null
    if (!appEl) continue

    const propsEl = container.querySelector('script[data-mf-props]')
    let props: P = {} as P
    if (propsEl?.textContent) {
      try { props = JSON.parse(propsEl.textContent) } catch {}
    }

    const root = hydrateRoot(appEl, createElement(Component, props))
    const bus = new DOMEventBus(container as HTMLElement, namespace)

    const unsubProps = bus.on<P>('propsChanged', (newProps) => {
      root.render(createElement(Component, newProps))
    })

    const unsubCommand = onCommand
      ? bus.on<{ type: string; payload: unknown }>('command', ({ type, payload }) => {
          onCommand(type, payload)
        })
      : undefined

    teardowns.push(() => {
      unsubProps()
      unsubCommand?.()
      root.unmount()
    })
  }

  return () => teardowns.forEach((fn) => fn())
}
