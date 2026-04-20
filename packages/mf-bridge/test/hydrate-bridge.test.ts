/**
 * Tests for hydrateWithBridge and MFBridgeHydrated.
 *
 * hydrateWithBridge — remote client bundle: hydrates SSR content and sets up
 *   DOMEventBus so the host can stream prop updates post-hydration.
 *
 * MFBridgeHydrated — host client component: dispatches propsChanged events
 *   to an already-hydrated remote fragment.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createElement, useState } from 'react'
import { hydrateWithBridge } from '../src/hydrate.js'
import { MFBridgeHydrated } from '../src/host.js'
import { DOMEventBus } from '../src/dom-event-bus.js'

afterEach(cleanup)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a minimal DOM structure that MFBridgeSSR (url mode) would emit:
 *   <div data-mf-host data-mf-namespace="[ns]">
 *     <div data-mf-ssr="[id]">
 *       <script data-mf-props>{...props}</script>
 *       <div data-mf-app>[static HTML]</div>
 *     </div>
 *   </div>
 */
function buildSSRFragment(namespace: string, props: object, staticHtml = '<span>ssr</span>') {
  const host = document.createElement('div')
  host.setAttribute('data-mf-host', '')
  host.setAttribute('data-mf-namespace', namespace)

  const frag = document.createElement('div')
  frag.setAttribute('data-mf-ssr', 'TestWidget')

  const propsScript = document.createElement('script')
  propsScript.type = 'application/json'
  propsScript.setAttribute('data-mf-props', '')
  propsScript.textContent = JSON.stringify(props)

  const app = document.createElement('div')
  app.setAttribute('data-mf-app', '')
  app.innerHTML = staticHtml

  frag.appendChild(propsScript)
  frag.appendChild(app)
  host.appendChild(frag)
  document.body.appendChild(host)
  return host
}

// ─── hydrateWithBridge ───────────────────────────────────────────────────────

describe('hydrateWithBridge', () => {
  it('hydrates the [data-mf-app] element with the component and initial props', async () => {
    const host = buildSSRFragment('checkout', { orderId: '42' })

    function Widget({ orderId }: { orderId: string }) {
      return createElement('span', { 'data-testid': 'widget' }, orderId)
    }

    await act(async () => {
      hydrateWithBridge(Widget, { namespace: 'checkout' })
    })

    expect(host.querySelector('[data-testid="widget"]')?.textContent).toBe('42')
    host.remove()
  })

  it('re-renders the component when host sends propsChanged via bus', async () => {
    const host = buildSSRFragment('checkout', { orderId: '42' })

    function Widget({ orderId }: { orderId: string }) {
      return createElement('span', { 'data-testid': 'widget' }, orderId)
    }

    await act(async () => {
      hydrateWithBridge(Widget, { namespace: 'checkout' })
    })

    await act(async () => {
      const bus = new DOMEventBus(host, 'checkout')
      bus.send('propsChanged', { orderId: '99' })
    })

    expect(host.querySelector('[data-testid="widget"]')?.textContent).toBe('99')
    host.remove()
  })

  it('calls onCommand when host sends a command', async () => {
    const host = buildSSRFragment('checkout', {})
    const received: Array<{ type: string; payload: unknown }> = []

    function Widget() { return null }

    await act(async () => {
      hydrateWithBridge(Widget, {
        namespace: 'checkout',
        onCommand: (type, payload) => received.push({ type, payload }),
      })
    })

    const bus = new DOMEventBus(host, 'checkout')
    bus.send('command', { type: 'reset', payload: null })

    expect(received).toEqual([{ type: 'reset', payload: null }])
    host.remove()
  })

  it('teardown removes listeners — propsChanged no longer causes re-render', async () => {
    const host = buildSSRFragment('teardown-ns', { orderId: '1' })
    const rendered: string[] = []

    function Widget({ orderId }: { orderId: string }) {
      rendered.push(orderId)
      return createElement('span', null, orderId)
    }

    let teardown!: () => void
    await act(async () => { teardown = hydrateWithBridge(Widget, { namespace: 'teardown-ns' }) })
    rendered.length = 0

    teardown()

    const bus = new DOMEventBus(host, 'teardown-ns')
    bus.send('propsChanged', { orderId: '99' })

    expect(rendered).toHaveLength(0)
    host.remove()
  })

  it('returns a no-op teardown when [data-mf-namespace] element does not exist', () => {
    function Widget() { return null }
    const teardown = hydrateWithBridge(Widget, { namespace: 'nonexistent' })
    expect(() => teardown()).not.toThrow()
  })
})

// ─── MFBridgeHydrated ────────────────────────────────────────────────────────

describe('MFBridgeHydrated', () => {
  it('dispatches propsChanged when props change', async () => {
    const host = document.createElement('div')
    host.setAttribute('data-mf-namespace', 'checkout')
    document.body.appendChild(host)

    const received: object[] = []
    const bus = new DOMEventBus(host, 'checkout')
    bus.on<object>('propsChanged', (p) => received.push(p))

    let setProps!: (p: object) => void
    function Host() {
      const [props, setP] = useState<object>({ step: 'summary' })
      setProps = setP
      return createElement(MFBridgeHydrated, { namespace: 'checkout', props })
    }

    await act(async () => { render(createElement(Host)) })

    // First render: no propsChanged (initial props handled by hydrateWithBridge)
    expect(received).toHaveLength(0)

    await act(async () => { setProps({ step: 'payment' }) })
    expect(received).toEqual([{ step: 'payment' }])

    await act(async () => { setProps({ step: 'confirmation' }) })
    expect(received).toEqual([{ step: 'payment' }, { step: 'confirmation' }])

    host.remove()
  })

  it('does not dispatch propsChanged on initial render', async () => {
    const host = document.createElement('div')
    host.setAttribute('data-mf-namespace', 'ns-init')
    document.body.appendChild(host)

    const received: object[] = []
    const bus = new DOMEventBus(host, 'ns-init')
    bus.on<object>('propsChanged', (p) => received.push(p))

    await act(async () => {
      render(createElement(MFBridgeHydrated, { namespace: 'ns-init', props: { x: 1 } }))
    })

    expect(received).toHaveLength(0)
    host.remove()
  })

  it('populates commandRef after mount', async () => {
    const host = document.createElement('div')
    host.setAttribute('data-mf-namespace', 'cmd-ns')
    document.body.appendChild(host)

    const commandRef = { current: null as ((type: string, payload?: unknown) => void) | null }

    await act(async () => {
      render(createElement(MFBridgeHydrated, { namespace: 'cmd-ns', props: {}, commandRef }))
    })

    expect(commandRef.current).toBeTypeOf('function')
    host.remove()
  })

  it('clears commandRef on unmount', async () => {
    const host = document.createElement('div')
    host.setAttribute('data-mf-namespace', 'cmd-unmount')
    document.body.appendChild(host)

    const commandRef = { current: null as ((type: string, payload?: unknown) => void) | null }

    const { unmount } = await act(async () =>
      render(createElement(MFBridgeHydrated, { namespace: 'cmd-unmount', props: {}, commandRef }))
    )

    expect(commandRef.current).toBeTypeOf('function')
    await act(async () => { unmount() })
    expect(commandRef.current).toBeNull()

    host.remove()
  })

  it('forwards onEvent when remote emits an event', async () => {
    const host = document.createElement('div')
    host.setAttribute('data-mf-namespace', 'evt-ns')
    document.body.appendChild(host)

    const events: Array<{ type: string; payload: unknown }> = []
    const onEvent = vi.fn((type, payload) => events.push({ type, payload }))

    await act(async () => {
      render(createElement(MFBridgeHydrated, { namespace: 'evt-ns', props: {}, onEvent }))
    })

    const bus = new DOMEventBus(host, 'evt-ns')
    bus.send('event', { type: 'orderPlaced', payload: { id: 7 } })

    expect(events).toEqual([{ type: 'orderPlaced', payload: { id: 7 } }])
    host.remove()
  })
})

// ─── Integration: hydrateWithBridge + MFBridgeHydrated together ──────────────

describe('integration — full SSR + prop streaming cycle', () => {
  it('SSR hydrates and host streams three prop updates', async () => {
    const host = buildSSRFragment('checkout-full', { orderId: '1', step: 'summary' })
    const rendered: string[] = []

    function CheckoutWidget({ orderId, step }: { orderId: string; step: string }) {
      rendered.push(`${orderId}:${step}`)
      return createElement('span', null, `${orderId}:${step}`)
    }

    // Remote client: hydrate SSR content and set up bridge
    await act(async () => {
      hydrateWithBridge(CheckoutWidget, { namespace: 'checkout-full' })
    })
    rendered.length = 0 // reset after initial hydration render

    // Host client: stream prop updates
    let setStep!: (s: string) => void
    function HostController() {
      const [step, setS] = useState('summary')
      setStep = setS
      return createElement(MFBridgeHydrated, {
        namespace: 'checkout-full',
        props: { orderId: '1', step },
      })
    }

    await act(async () => { render(createElement(HostController)) })

    await act(async () => { setStep('payment') })
    await act(async () => { setStep('confirmation') })

    expect(rendered).toEqual(['1:payment', '1:confirmation'])
    host.remove()
  })
})
