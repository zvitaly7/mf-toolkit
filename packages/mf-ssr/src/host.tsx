import { Suspense, createElement, type ReactElement } from 'react'
import type { MFBridgeSSRProps } from './types.js'

export function MFBridgeSSR<P extends object>(props: MFBridgeSSRProps<P>): ReactElement {
  return createElement(
    Suspense,
    { fallback: props.fallback ?? null },
    // @ts-expect-error — async RSC: Promise return is not yet in public React types
    createElement(MFBridgeSSRFetcher, props),
  )
}

async function MFBridgeSSRFetcher<P extends object>({
  url,
  props,
  errorFallback = null,
  degradeFallback,
  timeout = 3_000,
}: MFBridgeSSRProps<P>): Promise<ReactElement | null> {
  try {
    const encoded = encodeURIComponent(JSON.stringify(props))
    const res = await fetch(`${url}?props=${encoded}`, {
      signal: AbortSignal.timeout(timeout),
    })
    if (!res.ok) throw new Error(`MFBridgeSSR: ${url} → ${res.status}`)
    const html = await res.text()
    return createElement('div', {
      'data-mf-host': true,
      dangerouslySetInnerHTML: { __html: html },
    })
  } catch {
    return (degradeFallback ?? errorFallback) as ReactElement | null
  }
}

export { MFBridgeSSRFetcher as _MFBridgeSSRFetcher }
