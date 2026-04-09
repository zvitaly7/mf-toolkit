import { createElement } from 'react'
import type { ComponentProps, ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { DOMEventBus } from './dom-event-bus.js'
import type { RegisterFn } from './types.js'

export { DOMEventBus } from './dom-event-bus.js'

/**
 * Wraps a React component for mounting by a host shell.
 *
 * Call this in your microfrontend's exposed entry module and export the result
 * as `register`. The host will call it at runtime with a mount point and props.
 *
 * @param Component       The React component to expose.
 * @param onBeforeMount   Optional hook called once before the first render.
 *   Use it for DI / service injection that must happen before the component
 *   sees its props.
 * @param onBeforeUnmount Optional hook called just before the component is
 *   unmounted. Use it to clean up DI registrations or other side-effects
 *   set up in `onBeforeMount`.
 *
 * @example
 * // mf/checkout/entry.ts  (exposed via Module Federation)
 * export const register = createMFEntry(
 *   CheckoutWidget,
 *   ({ props }) => { container.set(props.services) },
 *   ({ mountPointer }) => { container.reset() },
 * )
 */
export function createMFEntry<T extends ComponentType<any>>(
  Component: T,
  onBeforeMount?: (opts: {
    mountPointer: HTMLElement
    props: ComponentProps<T>
  }) => void,
  onBeforeUnmount?: (opts: { mountPointer: HTMLElement }) => void,
): RegisterFn<ComponentProps<T>> {
  return ({ mountPointer, props, namespace = 'mfbridge' }) => {
    onBeforeMount?.({ mountPointer, props })

    const root = createRoot(mountPointer)
    root.render(createElement(Component, props))

    const bus = new DOMEventBus(mountPointer, namespace)
    const unsubscribe = bus.on<ComponentProps<T>>('propsChanged', (newProps) => {
      root.render(createElement(Component, newProps))
    })

    return () => {
      onBeforeUnmount?.({ mountPointer })
      unsubscribe()
      root.unmount()
    }
  }
}
