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

// ─── Internal helpers ────────────────────────────────────────────────────────

function dbg(namespace: string, enabled: boolean, event: string, ...data: unknown[]) {
  if (enabled) console.debug(`[mf-bridge:${namespace}]`, event, ...data)
}

// ─── Preload cache ────────────────────────────────────────────────────────────

const preloadCache = new Map<
  () => Promise<RegisterFn<any>>,
  Promise<RegisterFn<any>>
>()

/**
 * Kicks off loading a remote module before `MFBridgeLazy` renders.
 * Call it as early as possible (on hover, on route prefetch, on app boot)
 * to cut down Time-to-Interactive.
 *
 * The loader function reference is used as the cache key — keep it stable
 * (module-level constant or `useCallback`). If `MFBridgeLazy` renders with
 * the same reference, it reuses the in-flight/resolved promise and skips a
 * second network request.
 *
 * @example
 * // Prefetch on hover
 * <button onMouseEnter={() => preloadMF(checkoutLoader)}>
 *   Open checkout
 * </button>
 *
 * // Later MFBridgeLazy renders and reuses the already-started load
 * <MFBridgeLazy register={checkoutLoader} props={...} />
 */
export function preloadMF<T extends RegisterFn<any>>(
  loader: () => Promise<T>,
): void {
  if (!preloadCache.has(loader)) {
    preloadCache.set(loader, loader() as Promise<RegisterFn<any>>)
  }
}

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
  /**
   * Enable `console.debug` logging for this bridge instance.
   * Logs mount, propsChanged, and unmount events with the namespace prefix.
   * Safe to leave in production — gated behind this flag.
   */
  debug?: boolean
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
  debug = false,
}: MFBridgeProps<T>): React.JSX.Element {
  const containerRef = useRef<HTMLElement | null>(null)
  const unmountRef = useRef<(() => void) | null>(null)
  const busRef = useRef<DOMEventBus | null>(null)
  const isFirstRender = useRef(true)
  const debugRef = useRef(debug)
  debugRef.current = debug

  // Re-run when register or namespace changes: tear down the old remote and
  // mount the new one. isFirstRender is reset so the props-streaming effect
  // skips the redundant initial send.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    isFirstRender.current = true
    const bus = new DOMEventBus(el, namespace)
    busRef.current = bus

    dbg(namespace, debugRef.current, 'mount', { props })
    unmountRef.current = register({ mountPointer: el, props, namespace })

    return () => {
      dbg(namespace, debugRef.current, 'unmount')
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
    dbg(namespace, debugRef.current, 'propsChanged', props)
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
   * Pre-warm it with `preloadMF(loader)` to start loading before render.
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
  /**
   * Enable `console.debug` logging for this bridge instance.
   * Logs load:start, load:ok, load:error events with the namespace prefix.
   */
  debug?: boolean
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
 * Call `preloadMF(loader)` before rendering to start the load early and
 * reduce Time-to-Interactive.
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
  debug = false,
}: MFBridgeLazyProps<T>): React.JSX.Element {
  const [registerFn, setRegisterFn] = useState<RegisterFn<any> | null>(null)
  const [failed, setFailed] = useState(false)

  // Keep callbacks in refs so changing them never triggers a reload.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onLoadRef = useRef(onLoad)
  onLoadRef.current = onLoad
  const debugRef = useRef(debug)
  debugRef.current = debug

  // Re-run whenever the factory reference changes: reset to loading state and
  // fetch the new remote. If preloadMF was called with the same loader, reuse
  // the in-flight/resolved promise — no second network request.
  // Cancellation prevents stale resolves from a previous factory from
  // overwriting state.
  useEffect(() => {
    let cancelled = false
    setRegisterFn(null)
    setFailed(false)

    const ns = namespace
    dbg(ns, debugRef.current, 'load:start')

    const cached = preloadCache.get(register)
    const promise = cached ?? (register() as Promise<RegisterFn<any>>)
    if (!cached) preloadCache.set(register, promise)

    promise
      .then((fn) => {
        if (!cancelled) {
          dbg(ns, debugRef.current, 'load:ok')
          setRegisterFn(() => fn)
          onLoadRef.current?.()
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        dbg(ns, debugRef.current, 'load:error', err)
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
    debug,
  })
}
