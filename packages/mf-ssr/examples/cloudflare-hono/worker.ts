// Remote side: Cloudflare Worker + Hono exposing a fragment endpoint.
// Deploy with `wrangler deploy`.

import { Hono } from 'hono'
import { createMFReactFragment } from '@mf-toolkit/mf-ssr/fragment'
import { CheckoutWidget } from './CheckoutWidget'

const fragmentHandler = createMFReactFragment(CheckoutWidget, {
  // Public, globally cached at Cloudflare's edge — very low TTFB for warm hits.
  cacheControl: 'public, s-maxage=30, stale-while-revalidate=60',
  vary: 'Accept-Language',
})

const app = new Hono()

app.get('/fragment', (c) => fragmentHandler(c.req.raw))

export default app
