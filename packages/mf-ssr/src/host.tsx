'use client'

import {
  Component,
  Suspense,
  createElement,
  lazy,
  useEffect,
  useRef,
  type ComponentType,
  type LazyExoticComponent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { DOMEventBus } from '@mf-toolkit/mf-bridge'
import type { MFBridgeSSRProps } from './types.js'
import { safeJsonStringify } from './utils.js'

// ─── Error boundary ──────────────────────────────────────────────────────────

interface EBProps {
  fallback: ReactNode
  children?: ReactNode
  onError?: (error: Error) => void
}
interface EBState { hasError: boolean }

class MFBridgeSSRErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { hasError: false }
  static getDerivedStateFromError(): EBState { return { hasError: true } }
  componentDidCatch(error: Error): void { this.props.onError?.(error) }
  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

// ─── Suspense helper (Promise → value; works on React 18 SSR and client) ─────

type TaggedPromise<T> = Promise<T> & {
  _status?: 'pending' | 'fulfilled' | 'rejected'
  _value?: T
  _reason?: unknown
}

function readPromise<T>(promise: TaggedPromise<T>): T {
  if (promise._status === 'fulfilled') return promise._value as T
  if (promise._status === 'rejected') throw promise._reason
  if (!promise._status) {
    promise._status = 'pending'
    promise.then(
      (value) => { promise._status = 'fulfilled'; promise._value = value },
      (reason) => { promise._status = 'rejected'; promise._reason = reason },
    )
  }
  throw promise
}

// ─── URL mode ────────────────────────────────────────────────────────────────
// SSR: fetches fragment HTML from the remote endpoint and dumps it via
// dangerouslySetInnerHTML. After hydration, streams prop updates (and receives
// events/commands) via a DOMEventBus on the wrapper element. The remote bundle
// must call `hydrateWithBridge()` to subscribe on the other end.

interface UrlModeProps<P extends object> {
  url: string
  props: P
  namespace?: string
  timeout: number
  fetchOptions?: Omit<RequestInit, 'signal'>
  cacheKey?: string
  retryCount?: number
  retryDelay?: number
  debug?: boolean
  onEvent?: (type: string, payload: unknown) => void
  commandRef?: { current: ((type: string, payload?: unknown) => void) | null }
}

interface LoaderModeProps<P extends object> {
  loader: () => Promise<ComponentType<P>>
  props: P
  timeout: number
  debug?: boolean
}

// Guard against payloads that exceed typical CDN / reverse-proxy URL limits.
// Most edge runtimes cap URLs at 8 KB; 4 KB is a conservative safe limit.
const MAX_PROPS_URL_BYTES = 4096

function mfLog(debug: boolean | undefined, ...args: unknown[]): void {
  if (debug) console.log('[mf-ssr]', ...args)
}

interface FetchOpts {
  fetchOptions?: Omit<RequestInit, 'signal'>
  retryCount?: number
  retryDelay?: number
  debug?: boolean
}

async function fetchWithRetry(
  url: string, fullUrl: string, timeout: number, opts: FetchOpts,
): Promise<string> {
  const { fetchOptions, retryCount = 0, retryDelay = 1000, debug } = opts
  let lastErr!: Error
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      mfLog(debug, `retrying ${url} (attempt ${attempt}/${retryCount})`)
      await new Promise<void>((r) => setTimeout(r, retryDelay))
    }
    try {
      const res = await fetch(fullUrl, { ...fetchOptions, signal: AbortSignal.timeout(timeout) })
      if (!res.ok) throw new Error(`MFBridgeSSR: ${url} → ${res.status}`)
      mfLog(debug, 'fragment fetched', { url, attempt })
      return await res.text()
    } catch (err) {
      lastErr = err as Error
      mfLog(debug, 'fetch attempt failed', { url, attempt, err })
    }
  }
  throw lastErr
}

function fetchFragmentHtml<P>(
  url: string, props: P, timeout: number, opts: FetchOpts = {},
): TaggedPromise<string> {
  const encoded = encodeURIComponent(JSON.stringify(props))
  const fullUrl = `${url}?props=${encoded}`
  if (fullUrl.length > MAX_PROPS_URL_BYTES) {
    const err = new Error(
      `MFBridgeSSR: props payload too large (${fullUrl.length} chars > ${MAX_PROPS_URL_BYTES} limit). ` +
      'Reduce props size or split into smaller fragments.',
    )
    const rejected = Promise.reject(err) as TaggedPromise<string>
    rejected._status = 'rejected'
    rejected._reason = err
    rejected.catch(() => {})
    return rejected
  }
  mfLog(opts.debug, 'fetching fragment', { url, retryCount: opts.retryCount ?? 0 })
  return fetchWithRetry(url, fullUrl, timeout, opts) as TaggedPromise<string>
}

// Cache keyed by URL + serialized initial props + timeout so the fetch promise
// survives Suspense retries (fiber state is discarded before first commit).
//
// Why rejected entries must stay: when a promise rejects, Suspense schedules a
// re-render. On that re-render, readPromise checks _status === 'rejected' and
// throws the Error (not the promise), which ErrorBoundary catches. If we evict
// the rejected entry before the re-render, readPromise gets a brand-new pending
// promise → Suspense suspends again → infinite retry, ErrorBoundary never fires.
//
// For server longevity: size is capped at FRAGMENT_CACHE_MAX. To clear stale
// rejected entries (e.g. after a remote recovers), call clearFragmentCache().
const FRAGMENT_CACHE_MAX = 50
const fragmentCache = new Map<string, TaggedPromise<string>>()

/** @internal Test-only: reset the url-mode fetch cache between test cases. */
export function __clearFragmentCache(): void {
  fragmentCache.clear()
}

/**
 * Evict one or all entries from the fragment cache.
 *
 * Use after a remote recovers from an error so the next render gets a fresh
 * fetch instead of the cached rejected promise. Pass a URL + props key to
 * evict a specific entry, or call with no arguments to flush the whole cache.
 */
export function clearFragmentCache(): void {
  fragmentCache.clear()
}

interface GetFragmentOpts extends FetchOpts {
  cacheKey?: string
}

function getFragmentHtml<P>(
  url: string, initialProps: P, timeout: number, opts: GetFragmentOpts = {},
): TaggedPromise<string> {
  const { cacheKey, ...fetchOpts } = opts
  const key = `${url}?${safeJsonStringify(initialProps)}#${timeout}#${cacheKey ?? ''}`
  const cached = fragmentCache.get(key)
  if (cached) return cached

  if (fragmentCache.size >= FRAGMENT_CACHE_MAX) {
    fragmentCache.delete(fragmentCache.keys().next().value as string)
  }

  const promise = fetchFragmentHtml(url, initialProps, timeout, fetchOpts)

  // Pre-rejected promises (e.g. URL-too-large) already have _status set
  // synchronously — don't cache them so the app can fix props and retry.
  if (promise._status === 'rejected') return promise

  fragmentCache.set(key, promise)
  return promise
}

/**
 * Pre-warm the fragment cache before `MFBridgeSSR` renders.
 *
 * Call this in a route loader, `getServerSideProps`, or a parent `useEffect`
 * so the fetch is already in-flight (or resolved) by the time the component
 * renders. When the cache is warm, Suspense skips the fallback entirely —
 * the fragment appears on the first paint with no loading state.
 *
 * ```ts
 * // Next.js App Router — prefetch in the Server Component before streaming
 * preloadFragment('https://checkout.acme.com/fragment', { orderId })
 * ```
 */
export function preloadFragment<P extends object>(
  url: string,
  props: P,
  opts?: { timeout?: number } & GetFragmentOpts,
): void {
  const { timeout = 3000, ...rest } = opts ?? {}
  getFragmentHtml(url, props, timeout, rest)
}

function UrlMode<P extends object>({
  url, props, namespace, timeout, fetchOptions, cacheKey,
  retryCount, retryDelay, debug, onEvent, commandRef,
}: UrlModeProps<P>): ReactElement {
  // Use the props from the very first render as the "initial" fetch key. Once
  // the fiber commits, useRef preserves it across updates. Before commit,
  // Suspense retries see the same prop values (parent didn't rerender), so the
  // cache key is stable.
  const initialPropsRef = useRef(props)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const busRef = useRef<DOMEventBus | null>(null)
  const isFirstPropsEffect = useRef(true)
  const onEventRef = useRef(onEvent); onEventRef.current = onEvent
  const commandRefRef = useRef(commandRef); commandRefRef.current = commandRef

  const html = readPromise(
    getFragmentHtml(url, initialPropsRef.current, timeout, {
      fetchOptions, cacheKey, retryCount, retryDelay, debug,
    }),
  )

  useEffect(() => {
    mfLog(debug, 'url-mode mounted', { url, namespace })
    return () => { mfLog(debug, 'url-mode unmounted', { url, namespace }) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!namespace) return
    const el = wrapperRef.current
    if (!el) return
    isFirstPropsEffect.current = true
    const bus = new DOMEventBus(el, namespace)
    busRef.current = bus
    if (commandRefRef.current) {
      commandRefRef.current.current = (type, payload) =>
        bus.send('command', { type, payload })
    }
    const unsub = bus.on<{ type: string; payload: unknown }>('event', ({ type, payload }) => {
      mfLog(debug, 'event received', { type, payload })
      onEventRef.current?.(type, payload)
    })
    return () => {
      unsub()
      busRef.current = null
      if (commandRefRef.current) commandRefRef.current.current = null
    }
  }, [namespace])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isFirstPropsEffect.current) { isFirstPropsEffect.current = false; return }
    mfLog(debug, 'propsChanged', props)
    busRef.current?.send('propsChanged', props)
  }, [props])  // eslint-disable-line react-hooks/exhaustive-deps

  return createElement('div', {
    ref: wrapperRef,
    'data-mf-host': '',
    ...(namespace ? { 'data-mf-namespace': namespace } : {}),
    dangerouslySetInnerHTML: { __html: html },
  })
}

// ─── Loader mode ─────────────────────────────────────────────────────────────
// The host imports the remote component directly (S3/CDN bundle, Module
// Federation runtime, dynamic import). Wraps it in React.lazy so SSR streams
// the fallback until the import resolves. Props flow naturally — when the
// parent re-renders, the remote re-renders with new props, no bridge needed.

// Cache keyed by loader reference so the `lazy()` result survives Suspense
// retries. Before first commit, React discards fiber state (including hooks),
// so we cannot store the lazy in useRef/useMemo — it would be recreated on
// every retry and never resolve. A module-level cache keeps the lazy stable
// across retries. Same contract as `MFBridgeLazy.register`: pass a stable
// loader reference (module-level or wrapped in `useCallback`).
const lazyCache = new WeakMap<
  () => Promise<ComponentType<object>>,
  LazyExoticComponent<ComponentType<object>>
>()

function getLazy<P extends object>(
  loader: () => Promise<ComponentType<P>>,
  timeout: number,
): LazyExoticComponent<ComponentType<P>> {
  const key = loader as unknown as () => Promise<ComponentType<object>>
  const cached = lazyCache.get(key)
  if (cached) return cached as unknown as LazyExoticComponent<ComponentType<P>>

  const created = lazy<ComponentType<P>>(() => {
    let timerId: ReturnType<typeof setTimeout> | undefined
    return Promise.race([
      loader().then((C) => ({ default: C })),
      new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () => reject(new Error('MFBridgeSSR: loader timeout')),
          timeout,
        )
      }),
    ]).finally(() => clearTimeout(timerId)) as Promise<{ default: ComponentType<P> }>
  })
  lazyCache.set(key, created as unknown as LazyExoticComponent<ComponentType<object>>)
  return created
}

function LoaderMode<P extends object>({ loader, props, timeout, debug }: LoaderModeProps<P>): ReactElement {
  const LazyComp = getLazy(loader, timeout)
  useEffect(() => {
    mfLog(debug, 'loader-mode mounted')
    return () => { mfLog(debug, 'loader-mode unmounted') }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return createElement(LazyComp as unknown as ComponentType<object>, props as object)
}

// ─── Public component ────────────────────────────────────────────────────────

/**
 * Renders a microfrontend with SSR + automatic client-side prop streaming.
 *
 * Two modes:
 *
 * **1) `loader` mode** — host imports the remote component directly (S3/CDN
 * bundle, Module Federation, dynamic import). No extra server needed. Uses
 * `React.lazy` + `<Suspense>` so SSR streams the fallback until the import
 * resolves. Prop updates flow as a normal React re-render.
 *
 * **2) `url` mode** — host fetches HTML from the remote's fragment endpoint
 * (e.g. `GET /fragment?props=...`) during SSR and inlines it. After hydration,
 * a `DOMEventBus` streams prop updates, commands, and events between the
 * host's MFBridgeSSR and the remote's `hydrateWithBridge` entry.
 *
 * This is a **Client Component** (`'use client'`) — it renders server-side
 * during SSR but hydrates and re-renders on the client, so parent state
 * changes automatically propagate to the remote.
 *
 * @example Loader mode (inline, no extra server)
 * <MFBridgeSSR
 *   loader={() => import('checkout-remote').then(m => m.Widget)}
 *   props={{ cartId, currentUser }}
 *   fallback={<Spinner />}
 *   errorFallback={<Error />}
 * />
 *
 * @example URL mode (polyrepo, each team deploys their own endpoint)
 * <MFBridgeSSR
 *   url="https://checkout.acme.com/fragment"
 *   namespace="checkout"
 *   props={{ cartId, currentUser }}
 *   onEvent={(type, payload) => { if (type === 'orderPlaced') navigate('/thanks') }}
 * />
 */
export function MFBridgeSSR<P extends object>(props: MFBridgeSSRProps<P>): ReactElement {
  const { fallback = null, errorFallback = null, timeout = 3000, onError, debug } = props

  const inner = props.loader
    ? createElement(LoaderMode<P>, { loader: props.loader, props: props.props, timeout, debug })
    : createElement(UrlMode<P>, {
        url: props.url,
        props: props.props,
        namespace: props.namespace,
        timeout,
        fetchOptions: props.fetchOptions,
        cacheKey: props.cacheKey,
        retryCount: props.retryCount,
        retryDelay: props.retryDelay,
        debug,
        onEvent: props.onEvent,
        commandRef: props.commandRef,
      })

  return createElement(
    MFBridgeSSRErrorBoundary,
    { fallback: errorFallback ?? fallback, onError },
    createElement(Suspense, { fallback }, inner),
  )
}
