import { createElement, Component, type ReactNode } from 'react'
import type { ComponentProps, ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { DOMEventBus } from './dom-event-bus.js'
import type { RegisterFn } from './types.js'

export { DOMEventBus } from './dom-event-bus.js'

// ─── Error boundary ───────────────────────────────────────────────────────────

interface BoundaryProps {
  onError?: (err: Error) => void
  children?: ReactNode
}

class MFEntryErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(error)
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

// ─── createMFEntry ────────────────────────────────────────────────────────────

/**
 * Wraps a React component for mounting by a host shell.
 *
 * Call this in your microfrontend's exposed entry module and export the result
 * as `register`. The host will call it at runtime with a mount point and props.
 *
 * @param Component       The React component to expose.
 * @param onBeforeMount   Optional hook called once before the first render.
 *   Use it for DI / service injection that must happen before the component
 *   sees its props. Receives `namespace`, `shadowRoot` (when the host enables
 *   `shadowDom`), an `emit` function to push events to the host shell via
 *   `onEvent`, and an `onCommand` function to subscribe to imperative commands
 *   sent by the host via `commandRef`.
 * @param onBeforeUnmount Optional hook called just before the component is
 *   unmounted. Use it to clean up DI registrations or other side-effects
 *   set up in `onBeforeMount`.
 * @param onError         Called when the component throws during render.
 *   The remote tree renders `null` instead of broken UI; the host is notified
 *   via this callback so it can show a fallback or log the error.
 *   The boundary resets automatically on the next `propsChanged` event.
 *
 * @example
 * // mf/checkout/entry.ts  (exposed via Module Federation)
 * export const register = createMFEntry(
 *   CheckoutWidget,
 *   ({ props, emit, onCommand, shadowRoot }) => {
 *     container.set(props.services)
 *     CheckoutWidget.onOrderPlaced = (id) => emit('orderPlaced', { id })
 *     onCommand((type) => {
 *       if (type === 'reset') CheckoutWidget.reset()
 *     })
 *     if (shadowRoot) {
 *       const sheet = new CSSStyleSheet()
 *       sheet.replaceSync(styles)
 *       shadowRoot.adoptedStyleSheets = [sheet]
 *     }
 *   },
 *   ({ mountPointer }) => { container.reset() },
 *   (err) => { logger.error('checkout crashed', err) },
 * )
 */
export function createMFEntry<T extends ComponentType<any>>(
  Component: T,
  onBeforeMount?: (opts: {
    mountPointer: HTMLElement
    props: ComponentProps<T>
    /** The CustomEvent namespace in use (matches the host's `namespace` prop). */
    namespace: string
    /**
     * Shadow root provided by the host when `shadowDom` is enabled.
     * Use it to inject component styles for CSS isolation via `adoptedStyleSheets`
     * or by appending a `<style>` element directly to the shadow root.
     *
     * @example
     * if (shadowRoot) {
     *   const sheet = new CSSStyleSheet()
     *   sheet.replaceSync(widgetStyles)
     *   shadowRoot.adoptedStyleSheets = [sheet]
     * }
     */
    shadowRoot: ShadowRoot | undefined
    /** Emit a custom event to the host shell. The host receives it via `onEvent`. */
    emit: (type: string, payload?: unknown) => void
    /**
     * Subscribe to imperative commands sent by the host via `commandRef`.
     * Returns an unsubscribe function. Subscriptions are automatically cleaned
     * up on unmount even if you don't call the returned unsubscribe function.
     *
     * @example
     * onCommand((type, payload) => {
     *   if (type === 'reset') formRef.current?.reset()
     *   if (type === 'focus') inputRef.current?.focus()
     * })
     */
    onCommand: (handler: (type: string, payload: unknown) => void) => () => void
  }) => void,
  onBeforeUnmount?: (opts: { mountPointer: HTMLElement }) => void,
  onError?: (err: Error) => void,
): RegisterFn<ComponentProps<T>> {
  return ({ mountPointer, shadowRoot, props, namespace = 'mfbridge' }) => {
    // Guard against accidental calls in SSR / non-DOM environments
    if (typeof document === 'undefined') return () => {}

    // DOMEventBus always lives on the outer host element so events cross
    // the shadow boundary transparently.
    const bus = new DOMEventBus(mountPointer, namespace)
    const emit = (type: string, payload?: unknown): void =>
      bus.send('event', { type, payload })

    // Track command subscriptions so they are auto-cleaned up on unmount.
    const commandUnsubs: Array<() => void> = []
    const onCommand = (handler: (type: string, payload: unknown) => void): () => void => {
      const unsub = bus.on<{ type: string; payload: unknown }>(
        'command',
        ({ type, payload }) => handler(type, payload),
      )
      commandUnsubs.push(unsub)
      return unsub
    }

    onBeforeMount?.({ mountPointer, shadowRoot, props, namespace, emit, onCommand })

    // errorKey increments on every propsChanged to reset the boundary so a
    // recovered component can render again after a previous crash.
    let errorKey = 0

    // When a shadow root is provided, mount React inside it for CSS isolation.
    const reactContainer: Element | DocumentFragment = shadowRoot ?? mountPointer
    const root = createRoot(reactContainer)

    function render(p: ComponentProps<T>): void {
      root.render(
        createElement(MFEntryErrorBoundary, { key: errorKey, onError }, createElement(Component, p)),
      )
    }

    render(props)

    const unsubscribe = bus.on<ComponentProps<T>>('propsChanged', (newProps) => {
      errorKey++
      render(newProps)
    })

    return () => {
      onBeforeUnmount?.({ mountPointer })
      unsubscribe()
      commandUnsubs.forEach((fn) => fn())
      root.unmount()
    }
  }
}
