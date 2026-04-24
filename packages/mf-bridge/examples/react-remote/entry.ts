// Remote side — React component exposed through Module Federation.
// Build this entry with your bundler (Webpack / Vite / Rollup) and expose the
// `register` export via `exposes: { './entry': './src/entry.ts' }`.

import { createMFEntry, type TypedEmit } from '@mf-toolkit/mf-bridge/entry'
import { CheckoutWidget } from './CheckoutWidget'

// Event contract shared with the host via a types-only package or local copy.
type CheckoutEvents = {
  orderPlaced: { orderId: string }
  cancelled: void
}

export const register = createMFEntry(CheckoutWidget, ({ emit, onCommand }) => {
  const typedEmit = emit as TypedEmit<CheckoutEvents>

  onCommand((type) => {
    if (type === 'resetForm') document.querySelector('form')?.reset()
  })

  // The remote can emit events the host listens to via onEvent.
  // Wire this up from inside CheckoutWidget (e.g. onSubmit).
  ;(window as any).__emitOrderPlaced = (id: string) =>
    typedEmit('orderPlaced', { orderId: id })
})
