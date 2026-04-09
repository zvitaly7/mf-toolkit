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
  const isFirstRender = useRef(true)

  // Re-run when register or namespace changes: tear down the old remote and
  // mount the new one. isFirstRender is reset so the props-streaming effect
  // skips the redundant initial send.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    isFirstRender.current = true
    const bus = new DOMEventBus(el, namespace)
    busRef.current = bus
    unmountRef.current = register({ mountPointer: el, props, namespace })

    return () => {
      busRef.current = null
      unmountRef.current?.()
      unmountRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, namespace])

  // Stream prop updates when props reference changes.
  // Skips the initial mount — props were already passed to register() above.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    busRef.current?.send('propsChanged', props)
  }, [props]) // eslint-disable-line react-hooks/exhaustive-deps

  return createElement(tagName, { ref: containerRef }) as React.JSX.Element
}

// ─── Lazy bridge ─────────────────────────────────────────────────────────────

export interface MFBridgeLazyProps<T extends () => Promise<RegisterFn<any>>> {
  /**
   * Async factory that resolves to a `RegisterFn`.
   * Typically `() => import('./remote').then(m => m.register)`.
   *
   * The factory is called again whenever its reference changes, so keep it
   * stable (define outside the component or wrap with `useCallback`).
   */
  register: T
  /** Props forwarded to the remote component. Type is inferred from `register`. */
  props: MFLazyProps<T>
  /** Rendered while the remote module is loading or if loading fails. */
  fallback?: ReactNode
  /** HTML tag used as the mount-point element. Defaults to `"mf-bridge"`. */
  tagName?: string
  /**
   * CustomEvent namespace for prop streaming.
   * Must match the namespace used by `createMFEntry` (defaults to `"mfbridge"`).
   */
  namespace?: string
  /**
   * Called when the `register` factory rejects (e.g. network error, missing chunk).
   * The component stays on `fallback` when this happens.
   */
  onError?: (err: unknown) => void
  /** Called once the remote module has loaded and is ready to mount. */
  onLoad?: () => void
}

/**
 * Lazily loads a microfrontend module and mounts it into the host shell.
 *
 * Renders `fallback` while loading. Once the remote module resolves,
 * switches to `MFBridge` which mounts the component and starts prop streaming.
 *
 * If `register` changes (e.g. switching between remotes) the previous remote
 * is torn down and the new one is loaded from scratch.
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
  onError,
  onLoad,
}: MFBridgeLazyProps<T>): React.JSX.Element {
  const [registerFn, setRegisterFn] = useState<RegisterFn<any> | null>(null)
  const [failed, setFailed] = useState(false)

  // Keep callbacks in refs so changing them never triggers a reload.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onLoadRef = useRef(onLoad)
  onLoadRef.current = onLoad

  // Re-run whenever the factory reference changes: reset to loading state and
  // fetch the new remote. Cancellation prevents stale resolves from a previous
  // factory from overwriting state.
  useEffect(() => {
    let cancelled = false
    setRegisterFn(null)
    setFailed(false)
    register()
      .then((fn) => {
        if (!cancelled) {
          setRegisterFn(() => fn)
          onLoadRef.current?.()
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFailed(true)
        onErrorRef.current?.(err)
      })
    return () => {
      cancelled = true
    }
  }, [register]) // eslint-disable-line react-hooks/exhaustive-deps

  if (failed || !registerFn) return createElement(() => fallback as React.JSX.Element)

  return createElement(MFBridge, {
    register: registerFn,
    props,
    tagName,
    namespace,
  })
}
