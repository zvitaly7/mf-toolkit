// Remote side: Bun HTTP server exposing a fragment endpoint.
// Run with `bun run server.ts`.

import { createMFReactFragment } from '@mf-toolkit/mf-ssr/fragment'
import { Widget } from './Widget'

const fragmentHandler = createMFReactFragment(Widget)

Bun.serve({
  port: 3001,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/fragment') return fragmentHandler(req)
    return new Response('Not found', { status: 404 })
  },
})

console.log('Fragment server listening on http://localhost:3001')
