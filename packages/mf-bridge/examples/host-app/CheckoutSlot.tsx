// Host side — drop this anywhere in your React tree.
// TypeScript infers `props` from the remote's `register` export automatically.

import { useRef, useState } from 'react'
import {
  MFBridgeLazy,
  preloadMF,
  type TypedOnEvent,
} from '@mf-toolkit/mf-bridge'

type CheckoutEvents = {
  orderPlaced: { orderId: string }
  cancelled: void
}

// Keep the loader reference stable — define at module scope.
const loadCheckout = () =>
  import('checkout/entry').then((m) => m.register)

// Optional: warm the cache early (e.g. on app boot or on hover of a CTA).
export const warmCheckout = () => preloadMF(loadCheckout)

export function CheckoutSlot({ orderId }: { orderId: string }) {
  const [step, setStep] = useState<'summary' | 'payment' | 'confirmation'>('summary')
  const commandRef = useRef<((type: string, payload?: unknown) => void) | null>(null)

  const onEvent: TypedOnEvent<CheckoutEvents> = (type, payload) => {
    if (type === 'orderPlaced') console.log('order', payload.orderId)
  }

  return (
    <>
      <MFBridgeLazy
        register={loadCheckout}
        props={{ orderId, step }}
        fallback={<CheckoutSkeleton />}
        errorFallback={<p>Checkout is temporarily unavailable.</p>}
        timeout={5000}
        retryCount={2}
        retryDelay={500}
        onEvent={onEvent}
        commandRef={commandRef}
        onError={(err, retry) => {
          console.error('[checkout] load failed', err)
          setTimeout(retry, 2000)
        }}
        debug={process.env.NODE_ENV !== 'production'}
      />
      <button onClick={() => setStep('payment')}>Continue</button>
      <button onClick={() => commandRef.current?.('resetForm')}>Reset</button>
    </>
  )
}

function CheckoutSkeleton() {
  return <div style={{ height: 400, background: '#f0f0f0' }} />
}
