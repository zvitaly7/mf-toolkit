import type { ComponentType, ReactNode } from 'react'

export type MFFragmentHandler = (req: Request) => Promise<Response>

interface MFBridgeSSRBaseProps<P extends object> {
  /** Props passed to the remote component. Type-safe per mode. */
  props: P
  /** Rendered while the component is loading (Suspense fallback). */
  fallback?: ReactNode
  /** Rendered if fetch/loader fails (error boundary fallback). */
  errorFallback?: ReactNode
  /** Abort fetch / loader after N ms. Default: 3000. */
  timeout?: number
  /**
   * Called when the fragment fetch or loader throws.
   * Use for error observability (Sentry, DataDog, etc.) without replacing
   * the visual fallback — `errorFallback` still controls what the user sees.
   */
  onError?: (error: Error) => void
}

/** Approach 1: remote exposes an HTTP fragment endpoint. */
interface MFBridgeSSRUrlProps<P extends object> extends MFBridgeSSRBaseProps<P> {
  url: string
  loader?: never
  /**
   * CustomEvent namespace for the host→remote prop/command bridge.
   * Must match the `namespace` passed to `hydrateWithBridge` in the remote bundle.
   * When omitted, the bridge is skipped — only the initial SSR HTML is rendered.
   */
  namespace?: string
  /** Called when the remote emits a custom event via `emit()`. */
  onEvent?: (type: string, payload: unknown) => void
  /**
   * Ref populated with a `send(type, payload?)` function after mount.
   * Use it to dispatch imperative commands to the remote.
   */
  commandRef?: { current: ((type: string, payload?: unknown) => void) | null }
  /**
   * Extra options forwarded to `fetch()`.
   * Use for auth headers, cookies, or distributed-tracing headers:
   * ```tsx
   * fetchOptions={{ headers: { authorization: `Bearer ${token}`, 'x-request-id': traceId } }}
   * ```
   * `signal` is managed internally (AbortSignal.timeout) and cannot be overridden here.
   */
  fetchOptions?: Omit<RequestInit, 'signal'>
  /**
   * Explicit suffix appended to the internal fragment cache key.
   *
   * The default key is `url + props + timeout`. When `fetchOptions` carries
   * per-user auth (e.g. a Bearer token or session cookie), different users
   * would otherwise share the same cache slot and see each other's fragments.
   *
   * Set `cacheKey` to any stable per-user identifier:
   * ```tsx
   * cacheKey={userId}   // each user gets their own cached fragment
   * ```
   */
  cacheKey?: string
}

/** Approach 2: host imports the component directly (S3/CDN remote, no extra server). */
interface MFBridgeSSRLoaderProps<P extends object> extends MFBridgeSSRBaseProps<P> {
  loader: () => Promise<ComponentType<P>>
  url?: never
  namespace?: never
  onEvent?: never
  commandRef?: never
  fetchOptions?: never
  cacheKey?: never
}

export type MFBridgeSSRProps<P extends object = object> =
  | MFBridgeSSRUrlProps<P>
  | MFBridgeSSRLoaderProps<P>

export interface HydrateRemoteOpts {
  id?: string
  selector?: string
}
