/**
 * @vitest-environment jsdom
 *
 * End-to-end url-mode prop streaming: host setState → React re-render →
 * useEffect([props]) → bus.send('propsChanged', props) → CustomEvent fires →
 * remote listener runs.
 *
 * Measures the full React → DOM event round-trip. This is the steady-state
 * hot path once the fragment is hydrated (no re-fetch, just bridge dispatches).
 */
import { bench, describe } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createElement, useState } from 'react'
import { MFBridgeSSR, __clearFragmentCache } from '../src/host.js'
import { DOMEventBus } from '@mf-toolkit/mf-bridge'

const FRAG_HTML =
  '<div data-mf-ssr="W"><script type="application/json" data-mf-props="">{"v":0}</script><div data-mf-app=""><span>content</span></div></div>'

function stubFetch(): void {
  // @ts-expect-error jsdom fetch stub
  globalThis.fetch = () => Promise.resolve({
    ok: true,
    text: () => Promise.resolve(FRAG_HTML),
  })
}

async function mountHost(listeners: number): Promise<{
  setV: (n: number) => void
  cleanup: () => void
}> {
  stubFetch()
  __clearFragmentCache()

  let setV!: (n: number) => void
  function Parent() {
    const [v, set] = useState(0)
    setV = set
    return createElement(MFBridgeSSR, {
      url: 'http://bench/',
      props: { v },
      namespace: 'bench',
    })
  }

  const { container, findByText, unmount } = render(createElement(Parent))
  await findByText('content')

  const host = container.querySelector('[data-mf-host]') as HTMLElement
  const bus = new DOMEventBus(host, 'bench')
  const unsubs: Array<() => void> = []
  for (let i = 0; i < listeners; i++) {
    unsubs.push(bus.on<object>('propsChanged', () => { /* noop */ }))
  }
  return {
    setV,
    cleanup: () => {
      for (const u of unsubs) u()
      unmount()
      cleanup()
    },
  }
}

describe('url-mode propsChanged — 1 remote listener', () => {
  let ctx: Awaited<ReturnType<typeof mountHost>>
  let counter = 0

  bench('setState → propsChanged dispatch', async () => {
    if (!ctx) ctx = await mountHost(1)
    await act(async () => { ctx.setV(++counter) })
  }, {
    teardown: () => { if (ctx) ctx.cleanup() },
  })
})

describe('url-mode propsChanged — 10 remote listeners', () => {
  let ctx: Awaited<ReturnType<typeof mountHost>>
  let counter = 0

  bench('setState → propsChanged dispatch', async () => {
    if (!ctx) ctx = await mountHost(10)
    await act(async () => { ctx.setV(++counter) })
  }, {
    teardown: () => { if (ctx) ctx.cleanup() },
  })
})
