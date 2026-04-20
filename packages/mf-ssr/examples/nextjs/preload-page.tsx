// Host side: Next.js App Router Server Component.
// Preloads the fragment fetch before streaming the page — Suspense skips the fallback
// because the response is already in-flight (or resolved) when CheckoutSlot renders.

import { preloadFragment } from '@mf-toolkit/mf-ssr'
import { CheckoutSlot } from './checkout-slot'

interface Props {
  params: { cartId: string }
}

export default async function CheckoutPage({ params }: Props) {
  // Kick off the fragment fetch immediately — before React starts streaming.
  preloadFragment(process.env.NEXT_PUBLIC_CHECKOUT_FRAGMENT_URL!, { cartId: params.cartId, step: 'summary' })

  return (
    <main>
      <h1>Checkout</h1>
      <CheckoutSlot cartId={params.cartId} />
    </main>
  )
}
