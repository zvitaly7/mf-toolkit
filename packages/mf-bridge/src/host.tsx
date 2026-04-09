import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { DOMEventBus } from './dom-event-bus.js'
import type { MFLazyProps, MFProps, RegisterFn } from './types.js'

const DEFAULT_NS = 'mfbridge'

// ─── Sync bridge ─────────────────────────────────────────────────────────────

export interface MFBridgeProps<T extends RegisterFn<any>> {
  /** Synchronous register function returned by `createMFEntry` on the MF side. */
  register: T
  /** Props forwarded to the remote component. Type is inferred from `register`. */
  props: MFProps<T>
  /** HTML tag used as the mount-point element. Defaults to `"mf-bridge"`. */
  tagName?: string
  /**
   * CustomEvent namespace for prop streaming.
   * Must match the namespace used by `createMFEntry` (defaults to `"mfbridge"`).
   */
  namespace?: string
}

/**
 * Mounts a microfrontend React component synchronously into a host shell.
 *
 * Use this when the `register` function is already loaded (e.g. from a
 * pre-loaded remote). For lazy/async loading use `MFBridgeLazy`.
 *
 * Props changes are streamed to the remote component via DOM CustomEvents —
 * no shared module state required.
 *
 * @example
 * <MFBridge
 *   register={checkoutRegister}
 *   props={{ orderId }}
 * />
 */
export function MFBridge<T extends RegisterFn<any>>({
  register,
  props,
  tagName = 'mf-bridge',
  namespace = DEFAULT_NS,
}: MFBridgeProps<T>): React.JSX.Element {
  const containerRef = useRef<HTMLElement | null>(null)
  const unmountRef = useRef<(() => void) | null>(null)
  const busRef = useRef<DOMEventBus | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const bus = new DOMEventBus(el, namespace)
    busRef.current = bus
    unmountRef.current = register({ mountPointer: el, props, namespace })

    return () => {
      busRef.current = null
      unmountRef.current?.()
      unmountRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stream prop updates, skipping the initial mount (props already passed above).
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    busRef.current?.send('propsChanged', props)
  })

  return createElement(tagName, { ref: containerRef }) as React.JSX.Element
}

// ─── Lazy bridge ─────────────────────────────────────────────────────────────

export interface MFBridgeLazyProps<T extends () => Promise<RegisterFn<any>>> {
  /**
   * Async factory that resolves to a `RegisterFn`.
   * Typically `() => import('./remote').then(m => m.register)`.
   */
  register: T
  /** Props forwarded to the remote component. Type is inferred from `register`. */
  props: MFLazyProps<T>
  /** Rendered while the remote module is loading. */
  fallback?: ReactNode
  /** HTML tag used as the mount-point element. Defaults to `"mf-bridge"`. */
  tagName?: string
  /**
   * CustomEvent namespace for prop streaming.
   * Must match the namespace used by `createMFEntry` (defaults to `"mfbridge"`).
   */
  namespace?: string
}

/**
 * Lazily loads a microfrontend module and mounts it into the host shell.
 *
 * Renders `fallback` while loading. Once the remote module resolves,
 * switches to `MFBridge` which mounts the component and starts prop streaming.
 *
 * @example
 * <MFBridgeLazy
 *   register={() => import('./mf-checkout').then(m => m.register)}
 *   props={{ orderId, services }}
 *   fallback={<LocalCheckout orderId={orderId} />}
 * />
 */
export function MFBridgeLazy<T extends () => Promise<RegisterFn<any>>>({
  register,
  props,
  fallback = null,
  tagName = 'mf-bridge',
  namespace = DEFAULT_NS,
}: MFBridgeLazyProps<T>): React.JSX.Element {
  const [registerFn, setRegisterFn] = useState<RegisterFn<any> | null>(null)

  useEffect(() => {
    let cancelled = false
    register().then((fn) => {
      if (!cancelled) setRegisterFn(() => fn)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!registerFn) return createElement(() => fallback as React.JSX.Element)

  return createElement(MFBridge, {
    register: registerFn,
    props,
    tagName,
    namespace,
  })
}
