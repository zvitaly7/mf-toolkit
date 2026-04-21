// Remote side: Next.js Route Handler that exposes the fragment endpoint.
// Deploy this in the checkout team's own Next.js app.

import { createMFReactFragment } from '@mf-toolkit/mf-ssr/fragment'
import { CheckoutWidget } from '../../CheckoutWidget'

// Public fragments can opt into CDN caching:
// const handler = createMFReactFragment(CheckoutWidget, {
//   cacheControl: 'public, s-maxage=10, stale-while-revalidate=30',
//   vary: 'Accept-Language',
// })

// Private/auth-gated fragments should not be cached at the CDN:
const handler = createMFReactFragment(CheckoutWidget)

export const GET = handler
