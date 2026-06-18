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
  /**
   * Called when the fragment cannot be produced — either the `?props=` query
   * is malformed JSON (the fragment still renders with empty props) or the
   * component throws during server render (a `500` response is returned).
   * Use for error observability (Sentry, DataDog, etc.).
   */
  onError?: (error: Error) => void
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
      try {
        props = JSON.parse(decodeURIComponent(rawProps))
      } catch (err) {
        opts?.onError?.(
          new Error(
            `createMFReactFragment: failed to parse ?props= for "${fragmentId}": ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        )
      }
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

    try {
      const stream = await renderToReadableStream(createElement(FragmentShell))
      const headers: Record<string, string> = {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': cacheControl,
      }
      if (opts?.vary) headers['Vary'] = opts.vary
      return new Response(stream, { headers })
    } catch (err) {
      // Shell render threw before the first flush — surface it and return a
      // 500 instead of letting the handler's promise reject (which would crash
      // the remote's request handler or leak a stack trace to the client).
      opts?.onError?.(err instanceof Error ? err : new Error(String(err)))
      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
  }
}
