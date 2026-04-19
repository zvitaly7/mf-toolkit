import { DOMEventBus } from './dom-event-bus.js'
import type { RegisterFn } from './types.js'

// ─── defineMFEntry ────────────────────────────────────────────────────────────

/**
 * Shared mount options passed to `mount`. Identical to what `createMFEntry`
 * exposes in `onBeforeMount`, making the two APIs symmetric.
 */
export interface MFMountOpts<P extends object> {
  mountPointer: HTMLElement
  shadowRoot: ShadowRoot | undefined
  props: P
  namespace: string
  /** Emit a custom event to the host shell. The host receives it via `onEvent`. */
  emit: (type: string, payload?: unknown) => void
  /**
   * Subscribe to imperative commands sent by the host via `commandRef`.
   * Returns an unsubscribe function. Auto-cleaned up on unmount.
   */
  onCommand: (handler: (type: string, payload: unknown) => void) => () => void
}

/**
 * Framework-agnostic alternative to `createMFEntry`.
 *
 * Use this when the microfrontend is built with Vue, Angular, Svelte, vanilla
 * JS, or any other framework. The host side (`MFBridge` / `MFBridgeLazy`) does
 * not change — it always works with `RegisterFn` regardless of what produced it.
 *
 * `mount` receives the mount-point element and initial props and must return an
 * opaque instance value that is forwarded to `update` and `unmount`. Return
 * `null` / `undefined` if you don't need to track state across calls.
 *
 * `update` is called whenever the host streams new props via `MFBridge`.
 * Omit it if your framework handles reactivity internally (e.g. a Vue app
 * whose root component reads from a shared reactive store you update yourself).
 *
 * `unmount` performs cleanup — destroy the framework app, remove DOM nodes,
 * cancel subscriptions, etc.
 *
 * @example
 * // Vue 3 remote
 * export const register = defineMFEntry({
 *   mount({ mountPointer, props }) {
 *     const app = createApp(MyWidget, props)
 *     app.mount(mountPointer)
 *     return app
 *   },
 *   update(app, props) {
 *     // Vue 3 doesn't have a built-in updateProps; use a store or recreate.
 *     app.unmount()
 *     createApp(MyWidget, props).mount(mountPointer)
 *   },
 *   unmount(app) {
 *     app.unmount()
 *   },
 * })
 *
 * @example
 * // Vanilla JS remote with events and commands
 * export const register = defineMFEntry<{ count: number }, HTMLElement>({
 *   mount({ mountPointer, props, emit, onCommand }) {
 *     const el = document.createElement('div')
 *     el.textContent = String(props.count)
 *     el.addEventListener('click', () => emit('clicked', { count: props.count }))
 *     mountPointer.appendChild(el)
 *     onCommand((type) => { if (type === 'reset') { el.textContent = '0' } })
 *     return el
 *   },
 *   update(el, props) {
 *     el.textContent = String(props.count)
 *   },
 *   unmount(el, mountPointer) {
 *     mountPointer.removeChild(el)
 *   },
 * })
 */
export function defineMFEntry<P extends object = object, I = unknown>(config: {
  mount: (opts: MFMountOpts<P>) => I
  update?: (instance: I, props: P) => void
  unmount: (instance: I, mountPointer: HTMLElement) => void
}): RegisterFn<P> {
  return ({ mountPointer, shadowRoot, props, namespace = 'mfbridge' }) => {
    if (typeof document === 'undefined') return () => {}

    const bus = new DOMEventBus(mountPointer, namespace)
    const emit = (type: string, payload?: unknown): void =>
      bus.send('event', { type, payload })

    const commandUnsubs: Array<() => void> = []
    const onCommand = (handler: (type: string, payload: unknown) => void): () => void => {
      const unsub = bus.on<{ type: string; payload: unknown }>(
        'command',
        ({ type, payload }) => handler(type, payload),
      )
      commandUnsubs.push(unsub)
      return unsub
    }

    const instance = config.mount({ mountPointer, shadowRoot, props, namespace, emit, onCommand })

    const unsubscribe = bus.on<P>('propsChanged', (newProps) => {
      config.update?.(instance, newProps)
    })

    return () => {
      unsubscribe()
      commandUnsubs.forEach((fn) => fn())
      config.unmount(instance, mountPointer)
    }
  }
}
