// Host side: standalone Bun server using MFBridgeSSR with preloadFragment.
// Demonstrates url-mode with retry + auth isolation.

import { renderToReadableStream } from 'react-dom/server'
import { createElement } from 'react'
import { MFBridgeSSR, preloadFragment } from '@mf-toolkit/mf-ssr'

const FRAGMENT_URL = 'http://localhost:3001/fragment'

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url)
    const cartId = url.searchParams.get('cartId') ?? 'demo'

    // Pre-warm the cache before React starts rendering.
    preloadFragment(FRAGMENT_URL, { cartId })

    const stream = await renderToReadableStream(
      createElement(MFBridgeSSR, {
        url: FRAGMENT_URL,
        namespace: 'widget',
        props: { cartId },
        fallback: createElement('div', null, 'Loading…'),
        retryCount: 2,
        retryDelay: 300,
      }),
    )
    return new Response(stream, { headers: { 'content-type': 'text/html' } })
  },
})

console.log('Host server listening on http://localhost:3000')
