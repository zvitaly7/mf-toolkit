// Remote side: client bundle entry for the checkout MF.
// Bundled separately and served as a static asset (Webpack / Vite / Rollup).
// hydrateWithBridge wires up the DOMEventBus so the host can stream prop updates.

import { hydrateWithBridge } from '@mf-toolkit/mf-bridge/hydrate'
import { CheckoutWidget } from '../../CheckoutWidget'

hydrateWithBridge(CheckoutWidget, {
  namespace: 'checkout',
  onCommand: (type, payload) => {
    if (type === 'scrollToTop') window.scrollTo({ top: 0, behavior: 'smooth' })
  },
})
