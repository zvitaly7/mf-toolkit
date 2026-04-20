import { createElement, type ComponentType } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import type { MFFragmentHandler } from './types.js'
import { safeJsonStringify } from './utils.js'

export interface CreateMFReactFragmentOpts {
  id?: string
  /**
   * Value for the `Cache-Control` response header.
   * Default: `'no-store'` — safe for authenticated / personalised fragments.
   * Set to e.g. `'public, s-maxage=60, stale-while-revalidate=30'` for
   * public, cacheable fragments served from a CDN.
   */
  cacheControl?: string
  /**
   * Value for the `Vary` response header.
   * Omitted by default. Typical value when caching public fragments:
   * `'Accept-Language'` or `'Accept-Encoding'`.
   */
  vary?: string
}

export function createMFReactFragment<P extends object>(
  Component: ComponentType<P>,
  opts?: CreateMFReactFragmentOpts,
): MFFragmentHandler {
  const fragmentId = opts?.id ?? Component.displayName ?? Component.name ?? 'mf'
  const cacheControl = opts?.cacheControl ?? 'no-store'

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const rawProps = url.searchParams.get('props')
    let props: P = {} as P
    if (rawProps) {
      try { props = JSON.parse(decodeURIComponent(rawProps)) } catch {}
    }

    const safeJson = safeJsonStringify(props)

    function FragmentShell() {
      return createElement(
        'div',
        { 'data-mf-ssr': fragmentId },
        createElement('script', {
          type: 'application/json',
          'data-mf-props': true,
          dangerouslySetInnerHTML: { __html: safeJson },
        }),
        createElement('div', { 'data-mf-app': true },
          createElement(Component, props),
        ),
      )
    }

    const stream = await renderToReadableStream(createElement(FragmentShell))
    const headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': cacheControl,
    }
    if (opts?.vary) headers['Vary'] = opts.vary
    return new Response(stream, { headers })
  }
}
