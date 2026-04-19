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
  loader,
  props,
  errorFallback = null,
  degradeFallback,
  timeout = 3_000,
}: MFBridgeSSRProps<P>): Promise<ReactElement | null> {
  const fallback = (degradeFallback ?? errorFallback) as ReactElement | null

  try {
    if (url) {
      // Approach 1 — fetch HTML from the remote's fragment endpoint
      const encoded = encodeURIComponent(JSON.stringify(props))
      const res = await fetch(`${url}?props=${encoded}`, {
        signal: AbortSignal.timeout(timeout),
      })
      if (!res.ok) throw new Error(`MFBridgeSSR: ${url} → ${res.status}`)
      const html = await res.text()
      return createElement('div', {
        'data-mf-host': true,
        ...(namespace ? { 'data-mf-namespace': namespace } : {}),
        dangerouslySetInnerHTML: { __html: html },
      })
    }

    // Approach 2 — import the component on the host server and render inline
    const Component = await Promise.race([
      loader!(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('MFBridgeSSR: loader timeout')), timeout),
      ),
    ])
    return createElement(Component, props)
  } catch {
    return fallback
  }
}

export { MFBridgeSSRFetcher as _MFBridgeSSRFetcher }
