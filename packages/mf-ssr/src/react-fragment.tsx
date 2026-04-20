import { createElement, type ComponentType } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import type { MFFragmentHandler } from './types.js'
import { safeJsonStringify } from './utils.js'

export interface CreateMFReactFragmentOpts {
  id?: string
}

export function createMFReactFragment<P extends object>(
  Component: ComponentType<P>,
  opts?: CreateMFReactFragmentOpts,
): MFFragmentHandler {
  const fragmentId = opts?.id ?? Component.displayName ?? Component.name ?? 'mf'

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
    return new Response(stream, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}
