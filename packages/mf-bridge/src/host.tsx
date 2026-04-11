import {
  createElement,
  Fragment,
  useCallback,
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

/**
 * Removes one or all entries from the preload cache.
 *
 * Pass a `loader` reference to evict a single entry — useful when you know
 * a specific remote needs a fresh fetch (e.g. after a deploy or on auth change).
 * Omit the argument to wipe the entire cache — useful in tests or when the
 * whole app shell reloads.
 *
 * After clearing, the next `preloadMF(loader)` or `MFBridgeLazy` render will
 * start a new network request.
 *
 * @example
 * // Evict one remote after a background deploy
 * clearPreloadCache(checkoutLoader)
 *
 * // Wipe all cached remotes on user logout
 * clearPreloadCache()
 */
export function clearPreloadCache(loader?: () => Promise<RegisterFn<any>>): void {
  if (loader !== undefined) {
    preloadCache.delete(loader)
  } else {
    preloadCache.clear()
  }
}

// ─── Style forwarding ────────────────────────────────────────────────────────

/**
 * Forwards host-page stylesheets into a Shadow DOM root so that styles
 * injected into `document.head` — Tailwind, CSS Modules, styled-components,
 * Emotion, global design-system sheets — are visible inside the shadow root.
 *
 * What it does:
 * - Clones existing `<style>` and `<link rel="stylesheet">` elements from head.
 * - Shares `document.adoptedStyleSheets` at call time (live `CSSStyleSheet`
 *   objects — edits are reflected in both document and shadow root).
 * - Observes `document.head` for new elements added after mount (lazy CSS-in-JS
 *   chunks, dynamically imported stylesheets).
 *
 * Returns a cleanup function that disconnects the observer — call it in
 * `onBeforeUnmount`, or let the `adoptHostStyles` prop handle it automatically.
 *
 * Note: host styles become visible inside the MF. CSS isolation is one-way —
 * MF styles still cannot leak out. CSS custom properties inherit through shadow
 * DOM regardless of this setting.
 *
 * @example
 * // Manual usage in createMFEntry
 * let stopForwarding: (() => void) | undefined
 * createMFEntry(
 *   Widget,
 *   ({ shadowRoot }) => {
 *     if (shadowRoot) stopForwarding = forwardHostStyles(shadowRoot)
 *   },
 *   () => { stopForwarding?.() },
 * )
 */
export function forwardHostStyles(shadowRoot: ShadowRoot): () => void {
  if (typeof document === 'undefined') return () => {}

  // Clone existing <style> and <link rel="stylesheet"> elements.
  document.head
    .querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]')
    .forEach((el) => shadowRoot.appendChild(el.cloneNode(true)))

  // Share adoptedStyleSheets — CSSStyleSheet objects are live so mutations
  // (e.g. emotion speedy mode updating rules) are reflected immediately.
  if (document.adoptedStyleSheets?.length) {
    shadowRoot.adoptedStyleSheets = [
      ...shadowRoot.adoptedStyleSheets,
      ...document.adoptedStyleSheets,
    ]
  }

  // Watch for stylesheets injected after mount (lazy CSS-in-JS, dynamic imports).
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      Array.from(mutation.addedNodes).forEach((node) => {
        if (
          node instanceof HTMLStyleElement ||
          (node instanceof HTMLLinkElement && node.rel === 'stylesheet')
        ) {
          shadowRoot.appendChild(node.cloneNode(true))
        }
      })
    }
  })
  observer.observe(document.head, { childList: true })

  return () => observer.disconnect()
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
  /**
   * Called when the remote component emits a custom event via `emit(type, payload)`.
   * Enables type-safe remote→host communication without shared module state.
   *
   * @example
   * <MFBridge
   *   register={checkoutRegister}
   *   props={{ orderId }}
   *   onEvent={(type, payload) => {
   *     if (type === 'orderPlaced') navigate('/confirmation')
   *   }}
   * />
   */
  onEvent?: (type: string, payload: unknown) => void
  /**
   * HTML attributes forwarded to the mount-point element.
   * Use to set `className`, `style`, `id`, `data-*`, ARIA attributes, etc.
   * The `ref` is managed internally and cannot be overridden here.
   *
   * @example
   * <MFBridge
   *   register={checkoutRegister}
   *   props={{ orderId }}
   *   containerProps={{ className: 'checkout-slot', style: { minHeight: 200 } }}
   * />
   */
  containerProps?: Omit<React.HTMLAttributes<HTMLElement>, 'ref'>
  /**
   * Mutable ref populated with a `send(type, payload?)` function once the
   * remote component is mounted. Use it to dispatch imperative commands to the
   * remote from the host. The ref is set to `null` on unmount.
   *
   * The remote receives commands by calling `onCommand(handler)` inside
   * `onBeforeMount` (provided by `createMFEntry`).
   *
   * @example
   * const cmdRef = useRef<(type: string, payload?: unknown) => void>(null)
   * <MFBridge register={checkoutRegister} props={...} commandRef={cmdRef} />
   * // later:
   * cmdRef.current?.('resetForm', { keepEmail: true })
   */
  commandRef?: { current: ((type: string, payload?: unknown) => void) | null }
  /**
   * Ref populated with the mount-point HTMLElement after mount and cleared
   * on unmount. Use it to measure the element, call `focus()`, attach
   * third-party libraries, etc.
   *
   * @example
   * const mountRef = useRef<HTMLElement>(null)
   * <MFBridge register={checkoutRegister} props={...} mountRef={mountRef} />
   * // after mount:
   * mountRef.current?.getBoundingClientRect()
   */
  mountRef?: { current: HTMLElement | null }
  /**
   * When `true`, attaches a Shadow DOM to the mount-point element and renders
   * the remote component inside it. Provides native CSS isolation — host styles
   * do not bleed into the MF and vice versa.
   *
   * The shadow root (mode `"open"`) is passed to `createMFEntry`'s
   * `onBeforeMount` so the remote can inject its own styles via
   * `adoptedStyleSheets` or a `<style>` element.
   *
   * @example
   * <MFBridge register={checkoutRegister} props={...} shadowDom />
   */
  shadowDom?: boolean
  /**
   * When `true` (requires `shadowDom`), automatically forwards all host-page
   * stylesheets into the shadow root: `<style>`, `<link rel="stylesheet">`,
   * and `document.adoptedStyleSheets`. A `MutationObserver` on `document.head`
   * picks up styles injected after mount (CSS-in-JS lazy chunks, Tailwind CDN).
   *
   * Internally calls `forwardHostStyles(shadowRoot)` and cleans up the observer
   * on unmount — no manual cleanup needed.
   *
   * **Trade-off:** host styles become visible inside the MF (one-way isolation —
   * MF styles still cannot leak out). Use when you want to share the host's
   * design system or utility classes (e.g. Tailwind) while keeping the MF's
   * own styles from polluting the host.
   *
   * @example
   * <MFBridge register={checkoutRegister} props={...} shadowDom adoptHostStyles />
   */
  adoptHostStyles?: boolean
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
  onEvent,
  containerProps,
  commandRef,
  mountRef,
  shadowDom = false,
  adoptHostStyles = false,
}: MFBridgeProps<T>): React.JSX.Element {
  const containerRef = useRef<HTMLElement | null>(null)
  const unmountRef = useRef<(() => void) | null>(null)
  const busRef = useRef<DOMEventBus | null>(null)
  const isFirstRender = useRef(true)
  const debugRef = useRef(debug)
  debugRef.current = debug
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const commandRefRef = useRef(commandRef)
  commandRefRef.current = commandRef
  const mountRefRef = useRef(mountRef)
  mountRefRef.current = mountRef
  const shadowDomRef = useRef(shadowDom)
  shadowDomRef.current = shadowDom
  const adoptHostStylesRef = useRef(adoptHostStyles)
  adoptHostStylesRef.current = adoptHostStyles

  // Re-run when register or namespace changes: tear down the old remote and
  // mount the new one. isFirstRender is reset so the props-streaming effect
  // skips the redundant initial send.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    isFirstRender.current = true
    const bus = new DOMEventBus(el, namespace)
    busRef.current = bus

    // Expose the mount-point element to the host.
    if (mountRefRef.current) mountRefRef.current.current = el

    // Expose a send function so the host can dispatch commands to the remote.
    if (commandRefRef.current) {
      commandRefRef.current.current = (type, payload) =>
        bus.send('command', { type, payload })
    }

    // Attach a shadow root for CSS isolation when requested.
    // Re-use an existing shadow root (e.g. after StrictMode double-invoke).
    const shadowRoot = shadowDomRef.current
      ? (el.shadowRoot ?? el.attachShadow({ mode: 'open' }))
      : undefined

    // Forward host stylesheets into the shadow root so Tailwind, CSS Modules,
    // and CSS-in-JS outputs injected into document.head work inside the MF.
    const stopForwardingStyles = shadowRoot && adoptHostStylesRef.current
      ? forwardHostStyles(shadowRoot)
      : undefined

    dbg(namespace, debugRef.current, 'mount', { props, shadowDom: shadowDomRef.current })
    unmountRef.current = register({ mountPointer: el, shadowRoot, props, namespace })

    // Subscribe to remote-emitted events forwarded by createMFEntry's emit().
    const unsubEvent = bus.on<{ type: string; payload: unknown }>('event', ({ type, payload }) => {
      onEventRef.current?.(type, payload)
    })

    return () => {
      dbg(namespace, debugRef.current, 'unmount')
      unsubEvent()
      stopForwardingStyles?.()
      if (mountRefRef.current) mountRefRef.current.current = null
      if (commandRefRef.current) commandRefRef.current.current = null
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

  return createElement(tagName, { ...containerProps, ref: containerRef }) as React.JSX.Element
}

// ─── Lazy bridge ─────────────────────────────────────────────────────────────

/** Status reported by {@link MFBridgeLazyProps.onStatusChange}. */
export type MFBridgeStatus = 'loading' | 'ready' | 'error'

/**
 * Typed `onEvent` handler for the host side.
 *
 * Define an event map on the remote side and use this type on the host to get
 * fully-typed `type` and `payload` in the handler without changing component
 * signatures.
 *
 * @example
 * // Shared types (e.g. in a shared-types package)
 * type CheckoutEvents = {
 *   orderPlaced: { orderId: string }
 *   cancelled: void
 * }
 *
 * // Host side
 * const handleEvent: TypedOnEvent<CheckoutEvents> = (type, payload) => {
 *   if (type === 'orderPlaced') navigate(`/confirmation/${payload.orderId}`)
 *   if (type === 'cancelled') navigate('/cart')
 * }
 *
 * <MFBridgeLazy ... onEvent={handleEvent} />
 */
export type TypedOnEvent<Events extends Record<string, unknown>> =
  <K extends keyof Events & string>(type: K, payload: Events[K]) => void

/**
 * Typed `emit` function for the remote side.
 *
 * Use it to annotate the `emit` argument received in `onBeforeMount` so calls
 * to `emit` are validated against your event map at compile time.
 *
 * @example
 * // Shared types
 * type CheckoutEvents = {
 *   orderPlaced: { orderId: string }
 *   cancelled: void
 * }
 *
 * // Remote side
 * createMFEntry(CheckoutWidget, ({ emit }) => {
 *   const typedEmit = emit as TypedEmit<CheckoutEvents>
 *   CheckoutWidget.onOrderPlaced = (id) => typedEmit('orderPlaced', { orderId: id })
 * })
 */
export type TypedEmit<Events extends Record<string, unknown>> =
  <K extends keyof Events & string>(type: K, payload?: Events[K]) => void

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
  /**
   * Rendered when all load attempts fail. Overrides `fallback` in the error
   * state, letting you show a different UI for "loading" vs "failed".
   * Falls back to `fallback` if not provided.
   *
   * @example
   * <MFBridgeLazy
   *   fallback={<Spinner />}
   *   errorFallback={<ErrorBanner onRetry={retry} />}
   *   ...
   * />
   */
  errorFallback?: ReactNode
  /** HTML tag used as the mount-point element. Defaults to `"mf-bridge"`. */
  tagName?: string
  /**
   * CustomEvent namespace for prop streaming.
   * Must match the namespace used by `createMFEntry` (defaults to `"mfbridge"`).
   */
  namespace?: string
  /**
   * Called when all load attempts fail (including auto-retries).
   * The second argument is a `retry` function — call it to trigger a fresh
   * load attempt (bypasses the preload cache).
   *
   * @example
   * onError={(err, retry) => {
   *   logger.error(err)
   *   showToast('Failed to load module', { action: retry })
   * }}
   */
  onError?: (err: unknown, retry: () => void) => void
  /** Called once the remote module has loaded and is ready to mount. */
  onLoad?: () => void
  /**
   * Enable `console.debug` logging for this bridge instance.
   * Logs load:start, load:ok, load:retry, load:error events with the namespace prefix.
   */
  debug?: boolean
  /**
   * Number of additional load attempts after the first failure.
   * Defaults to `0` (no retry). Each retry calls the `register` factory again —
   * pair with `retryDelay` to avoid hammering a failing CDN.
   *
   * @example
   * // Try up to 3 times total, 1 s apart
   * <MFBridgeLazy retryCount={2} retryDelay={1000} ... />
   */
  retryCount?: number
  /**
   * Milliseconds to wait between retry attempts. Defaults to `0`.
   * Has no effect when `retryCount` is `0`.
   */
  retryDelay?: number
  /**
   * Called whenever the load status changes:
   * - `'loading'` — module fetch started (fires at the start of every attempt cycle).
   * - `'ready'`   — module loaded and remote component mounted.
   * - `'error'`   — all attempts (including auto-retries) failed.
   *
   * @example
   * <MFBridgeLazy
   *   onStatusChange={(s) => dispatch({ type: 'MF_STATUS', status: s })}
   *   ...
   * />
   */
  onStatusChange?: (status: MFBridgeStatus) => void
  /**
   * Per-attempt load timeout in milliseconds. If a single attempt does not
   * resolve within this window it is treated as a failure and the retry logic
   * kicks in (if `retryCount > 0`).
   * Defaults to `undefined` (no timeout).
   *
   * @example
   * // Fail fast after 5 s, then retry once
   * <MFBridgeLazy timeout={5000} retryCount={1} ... />
   */
  timeout?: number
  /**
   * Called when the remote component emits a custom event via `emit(type, payload)`.
   * Forwarded to the inner `MFBridge` once the remote module is loaded.
   *
   * @example
   * <MFBridgeLazy
   *   onEvent={(type, payload) => {
   *     if (type === 'orderPlaced') navigate('/confirmation')
   *   }}
   *   ...
   * />
   */
  onEvent?: (type: string, payload: unknown) => void
  /**
   * HTML attributes forwarded to the mount-point element.
   * Use to set `className`, `style`, `id`, `data-*`, ARIA attributes, etc.
   * Forwarded to the inner `MFBridge` once the remote module is loaded.
   *
   * @example
   * <MFBridgeLazy
   *   register={checkoutLoader}
   *   props={{ orderId }}
   *   containerProps={{ className: 'checkout-slot', 'aria-label': 'Checkout' }}
   * />
   */
  containerProps?: Omit<React.HTMLAttributes<HTMLElement>, 'ref'>
  /**
   * Mutable ref populated with a `send(type, payload?)` function once the
   * remote module has loaded and the component is mounted.
   * Forwarded to the inner `MFBridge`. Set to `null` while loading and on unmount.
   *
   * @example
   * const cmdRef = useRef<(type: string, payload?: unknown) => void>(null)
   * <MFBridgeLazy register={checkoutLoader} props={...} commandRef={cmdRef} />
   * // after load:
   * cmdRef.current?.('resetForm')
   */
  commandRef?: { current: ((type: string, payload?: unknown) => void) | null }
  /**
   * Ref populated with the mount-point HTMLElement once the remote module
   * has loaded and the component is mounted. Cleared on unmount.
   * Forwarded to the inner `MFBridge`.
   *
   * @example
   * const mountRef = useRef<HTMLElement>(null)
   * <MFBridgeLazy register={checkoutLoader} props={...} mountRef={mountRef} />
   */
  mountRef?: { current: HTMLElement | null }
  /**
   * When `true`, renders the remote component inside a Shadow DOM for CSS isolation.
   * Forwarded to the inner `MFBridge`.
   *
   * @example
   * <MFBridgeLazy register={checkoutLoader} props={...} shadowDom />
   */
  shadowDom?: boolean
  /** When `true` (requires `shadowDom`), forwards host stylesheets into the shadow root. See `MFBridgeProps.adoptHostStyles`. */
  adoptHostStyles?: boolean
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
 *   onError={(err, retry) => showRetryToast(retry)}
 *   onStatusChange={(s) => setMFStatus(s)}
 * />
 */
export function MFBridgeLazy<T extends () => Promise<RegisterFn<any>>>({
  register,
  props,
  fallback = null,
  errorFallback,
  tagName = 'mf-bridge',
  namespace = DEFAULT_NS,
  onError,
  onLoad,
  debug = false,
  retryCount = 0,
  retryDelay = 0,
  onStatusChange,
  timeout,
  onEvent,
  containerProps,
  commandRef,
  mountRef,
  shadowDom,
  adoptHostStyles,
}: MFBridgeLazyProps<T>): React.JSX.Element {
  const [registerFn, setRegisterFn] = useState<RegisterFn<any> | null>(null)
  const [failed, setFailed] = useState(false)
  // Incremented by the user-facing retry callback to trigger a fresh load cycle.
  const [retryKey, setRetryKey] = useState(0)

  // Stable retry callback exposed to onError. Resets state and triggers a
  // fresh load by incrementing retryKey (which is in effect deps).
  const retry = useCallback(() => {
    setFailed(false)
    setRegisterFn(null)
    setRetryKey((k) => k + 1)
  }, [])

  // Keep callbacks and config in refs so changing them never triggers a reload.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onLoadRef = useRef(onLoad)
  onLoadRef.current = onLoad
  const debugRef = useRef(debug)
  debugRef.current = debug
  const retryCountRef = useRef(retryCount)
  retryCountRef.current = retryCount
  const retryDelayRef = useRef(retryDelay)
  retryDelayRef.current = retryDelay
  const onStatusChangeRef = useRef(onStatusChange)
  onStatusChangeRef.current = onStatusChange
  const timeoutRef = useRef(timeout)
  timeoutRef.current = timeout
  const retryRef = useRef(retry)
  retryRef.current = retry

  // Re-run whenever the factory reference or retryKey changes: reset to loading
  // state and fetch the new/retried remote.
  // Cancellation prevents stale resolves from overwriting state.
  useEffect(() => {
    let cancelled = false
    let attempt = 0
    let loadTimeoutId: ReturnType<typeof setTimeout> | null = null
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null

    setRegisterFn(null)
    setFailed(false)

    const ns = namespace

    onStatusChangeRef.current?.('loading')

    function handleFailure(err: unknown): void {
      if (cancelled) return
      const maxAttempts = 1 + retryCountRef.current
      if (attempt < maxAttempts) {
        const remaining = maxAttempts - attempt
        dbg(ns, debugRef.current, 'load:retry', { attempt, remaining })
        const delay = retryDelayRef.current
        if (delay > 0) {
          retryTimeoutId = setTimeout(tryLoad, delay)
        } else {
          // Use a microtask to avoid unbounded synchronous recursion
          Promise.resolve().then(() => { if (!cancelled) tryLoad() })
        }
      } else {
        dbg(ns, debugRef.current, 'load:error', err)
        setFailed(true)
        onStatusChangeRef.current?.('error')
        onErrorRef.current?.(err, retryRef.current)
      }
    }

    function tryLoad(): void {
      attempt++
      let settled = false
      dbg(ns, debugRef.current, 'load:start', ...(attempt > 1 ? [{ attempt }] : []))

      // First attempt with no manual retry: use preloaded promise if available.
      // Any other case (auto-retry or manual retry via retryKey): bypass cache.
      let promise: Promise<RegisterFn<any>>
      if (attempt === 1 && retryKey === 0) {
        const cached = preloadCache.get(register)
        if (cached) {
          promise = cached
        } else {
          promise = register() as Promise<RegisterFn<any>>
          preloadCache.set(register, promise)
        }
      } else {
        preloadCache.delete(register)
        promise = register() as Promise<RegisterFn<any>>
      }

      // Per-attempt timeout: treat as failure when the window elapses.
      const timeoutMs = timeoutRef.current
      if (timeoutMs && timeoutMs > 0) {
        loadTimeoutId = setTimeout(() => {
          if (!settled && !cancelled) {
            settled = true
            loadTimeoutId = null
            handleFailure(new Error(`mf-bridge: load timed out after ${timeoutMs}ms`))
          }
        }, timeoutMs)
      }

      promise
        .then((fn) => {
          if (settled || cancelled) return
          settled = true
          if (loadTimeoutId !== null) { clearTimeout(loadTimeoutId); loadTimeoutId = null }
          dbg(ns, debugRef.current, 'load:ok')
          setRegisterFn(() => fn)
          onStatusChangeRef.current?.('ready')
          onLoadRef.current?.()
        })
        .catch((err: unknown) => {
          if (settled || cancelled) return
          settled = true
          if (loadTimeoutId !== null) { clearTimeout(loadTimeoutId); loadTimeoutId = null }
          handleFailure(err)
        })
    }

    tryLoad()

    return () => {
      cancelled = true
      if (loadTimeoutId !== null) clearTimeout(loadTimeoutId)
      if (retryTimeoutId !== null) clearTimeout(retryTimeoutId)
    }
  }, [register, retryKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return createElement(Fragment, null, errorFallback ?? fallback)
  if (!registerFn) return createElement(Fragment, null, fallback)

  return createElement(MFBridge, {
    register: registerFn,
    props,
    tagName,
    namespace,
    debug,
    onEvent,
    containerProps,
    commandRef,
    mountRef,
    shadowDom,
    adoptHostStyles,
  })
}

