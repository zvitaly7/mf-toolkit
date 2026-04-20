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
}

/** Approach 2: host imports the component directly (S3/CDN remote, no extra server). */
interface MFBridgeSSRLoaderProps<P extends object> extends MFBridgeSSRBaseProps<P> {
  loader: () => Promise<ComponentType<P>>
  url?: never
  namespace?: never
  onEvent?: never
  commandRef?: never
}

export type MFBridgeSSRProps<P extends object = object> =
  | MFBridgeSSRUrlProps<P>
  | MFBridgeSSRLoaderProps<P>

export interface HydrateRemoteOpts {
  id?: string
  selector?: string
}
