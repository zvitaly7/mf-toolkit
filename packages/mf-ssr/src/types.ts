import type { ComponentType, ReactNode } from 'react'

export type MFFragmentHandler = (req: Request) => Promise<Response>

interface MFBridgeSSRBaseProps<P extends object> {
  props: P
  fallback?: ReactNode
  errorFallback?: ReactNode
  degradeFallback?: ReactNode
  timeout?: number
  namespace?: string
}

/** Approach 1: remote exposes an HTTP fragment endpoint */
interface MFBridgeSSRUrlProps<P extends object> extends MFBridgeSSRBaseProps<P> {
  url: string
  loader?: never
}

/** Approach 2: host imports the component directly (S3/CDN remote, no extra server needed) */
interface MFBridgeSSRLoaderProps<P extends object> extends MFBridgeSSRBaseProps<P> {
  loader: () => Promise<ComponentType<P>>
  url?: never
}

export type MFBridgeSSRProps<P extends object = object> =
  | MFBridgeSSRUrlProps<P>
  | MFBridgeSSRLoaderProps<P>

export interface HydrateRemoteOpts {
  id?: string
  selector?: string
}
