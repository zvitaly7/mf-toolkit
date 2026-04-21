'use client'
// Host side: Next.js App Router client component that embeds the checkout MF with SSR.
// The SSR fetch happens during the initial server render; hydration + prop streaming
// happen on the client without any extra wiring on the host side.

import { useRef, useState } from 'react'
import { MFBridgeSSR } from '@mf-toolkit/mf-ssr'
import type { TypedSSROnEvent } from '@mf-toolkit/mf-ssr'

type CheckoutEvents = {
  orderPlaced: { orderId: string }
  cancelled: void
}

const onCheckoutEvent: TypedSSROnEvent<CheckoutEvents> = (type, payload) => {
  if (type === 'orderPlaced') {
    console.log('Order placed:', payload.orderId)
  }
}

export function CheckoutSlot({ cartId }: { cartId: string }) {
  const [step, setStep] = useState<'summary' | 'payment' | 'confirmation'>('summary')
  const commandRef = useRef<((type: string, payload?: unknown) => void) | null>(null)

  return (
    <>
      <MFBridgeSSR
        url={process.env.NEXT_PUBLIC_CHECKOUT_FRAGMENT_URL!}
        namespace="checkout"
        props={{ cartId, step }}
        fallback={<CheckoutSkeleton />}
        errorFallback={<p>Checkout is temporarily unavailable.</p>}
        timeout={3000}
        retryCount={1}
        onEvent={onCheckoutEvent}
        commandRef={commandRef}
        onError={(err) => console.error('[checkout] fragment error', err)}
        debug={process.env.NODE_ENV !== 'production'}
      />
      <button onClick={() => setStep('payment')}>Continue to payment</button>
      <button onClick={() => commandRef.current?.('scrollToTop')}>Scroll to top</button>
    </>
  )
}

function CheckoutSkeleton() {
  return <div style={{ height: 400, background: '#f0f0f0', borderRadius: 8 }} />
}
