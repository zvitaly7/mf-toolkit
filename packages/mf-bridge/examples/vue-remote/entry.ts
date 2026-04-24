// Remote side — Vue component exposed via defineMFEntry.
// Works the same way for Svelte, Angular, or vanilla JS — just implement the
// three lifecycle callbacks.

import { defineMFEntry } from '@mf-toolkit/mf-bridge/define-entry'
import { createApp, type App } from 'vue'
import CheckoutWidget from './CheckoutWidget.vue'

interface Props {
  orderId: string
  step: 'summary' | 'payment' | 'confirmation'
}

export const register = defineMFEntry<Props>({
  mount: ({ mountPointer, props }) => {
    const app: App = createApp(CheckoutWidget, props)
    app.mount(mountPointer)
    return { app }
  },
  update: ({ instance, props }) => {
    // Vue's reactivity doesn't rebind props on a mounted root — re-mount.
    instance.app.unmount()
    const fresh = createApp(CheckoutWidget, props)
    fresh.mount(instance.mountPointer)
    instance.app = fresh
  },
  unmount: ({ instance }) => {
    instance.app.unmount()
  },
})
