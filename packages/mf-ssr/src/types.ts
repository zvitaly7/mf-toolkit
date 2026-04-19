import type { ReactNode } from 'react'

export type MFFragmentHandler = (req: Request) => Promise<Response>

export interface MFBridgeSSRProps<P extends object = object> {
  url: string
  props: P
  fallback?: ReactNode
  errorFallback?: ReactNode
  degradeFallback?: ReactNode
  timeout?: number
  namespace?: string
}

export interface HydrateRemoteOpts {
  id?: string
  selector?: string
}
