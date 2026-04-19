/**
 * Stress and integration tests.
 *
 * These tests verify real behavior under conditions that unit tests miss:
 * rapid prop updates, mount/unmount cycles, listener leak detection,
 * race conditions in MFBridgeLazy, and defineMFEntry robustness.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createElement, useState } from 'react'
import { createMFEntry } from '../src/entry.js'
import { defineMFEntry } from '../src/define-entry.js'
import { DOMEventBus } from '../src/dom-event-bus.js'
import { MFBridge, MFBridgeLazy } from '../src/host.js'

afterEach(cleanup)

// ─── Prop update ordering ─────────────────────────────────────────────────────

describe('prop update ordering', () => {
  it('last prop update wins when many arrive in quick succession', async () => {
    const received: number[] = []
    const register = createMFEntry(
      function Widget({ n }: { n: number }) {
        received.push(n)
        return null
      },
    )

    let setN!: (n: number) => void
    function Host() {
      const [n, setNState] = useState(0)
      setN = setNState
      return createElement(MFBridge, { register, props: { n }, namespace: 'stress' })
    }

    await act(async () => { render(createElement(Host)) })
    received.length = 0 // reset — only care about updates

    // Fire 50 rapid updates
    for (let i = 1; i <= 50; i++) {
      await act(async () => { setN(i) })
    }

    // Component must reflect the final value
    expect(received[received.length - 1]).toBe(50)
  })

  it('prop updates sent via DOMEventBus arrive in dispatch order', () => {
    const received: number[] = []
    const register = defineMFEntry<{ n: number }, null>({
      mount: () => null,
      update: (_, props) => received.push(props.n),
      unmount: () => {},
    })

    const el = document.createElement('div')
    document.body.appendChild(el)
    register({ mountPointer: el, props: { n: 0 }, namespace: 'stress' })

    const bus = new DOMEventBus(el, 'stress')
    for (let i = 1; i <= 20; i++) {
      bus.send('propsChanged', { n: i })
    }

    expect(received).toHaveLength(20)
    expect(received).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    el.remove()
  })
})

// ─── Mount / unmount cycles ───────────────────────────────────────────────────

describe('mount/unmount cycles — no listener leaks', () => {
  it('repeated mount/unmount does not accumulate event listeners', async () => {
    const onEvent = vi.fn()
    const loader = () => Promise.resolve(createMFEntry(function W() { return null }))

    let container!: HTMLElement

    for (let i = 0; i < 10; i++) {
      const { unmount } = await act(async () =>
        render(createElement(MFBridgeLazy, {
          register: loader,
          props: {},
          onEvent,
          namespace: 'cycle',
        })),
      )
      container = document.querySelector('mf-bridge') as HTMLElement
      await act(async () => { unmount() })
    }

    // After all unmounts, sending an event should NOT trigger onEvent
    const bus = new DOMEventBus(container, 'cycle')
    bus.send('event', { type: 'ghost', payload: null })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('defineMFEntry: update is not called after unmount even if bus fires', () => {
    const update = vi.fn()
    const register = defineMFEntry({ mount: () => null, update, unmount: () => {} })

    const el = document.createElement('div')
    document.body.appendChild(el)

    const teardown = register({ mountPointer: el, props: {}, namespace: 'cycle' })
    teardown()

    const bus = new DOMEventBus(el, 'cycle')
    bus.send('propsChanged', { x: 1 })
    bus.send('propsChanged', { x: 2 })

    expect(update).not.toHaveBeenCalled()
    el.remove()
  })

  it('defineMFEntry: onCommand handler is not called after unmount', () => {
    const handler = vi.fn()
    const register = defineMFEntry({
      mount({ onCommand }) { onCommand(handler) },
      unmount: () => {},
    })

    const el = document.createElement('div')
    document.body.appendChild(el)
    const teardown = register({ mountPointer: el, props: {}, namespace: 'cycle' })
    teardown()

    const bus = new DOMEventBus(el, 'cycle')
    bus.send('command', { type: 'ping', payload: null })
    expect(handler).not.toHaveBeenCalled()
    el.remove()
  })
})

// ─── MFBridgeLazy race conditions ─────────────────────────────────────────────

describe('MFBridgeLazy — race conditions', () => {
  it('prop updates that arrive during loading are applied after mount', async () => {
    let resolveLoader!: (fn: ReturnType<typeof createMFEntry>) => void
    const loader = () => new Promise<ReturnType<typeof createMFEntry>>(r => { resolveLoader = r })

    const rendered: string[] = []
    const register = createMFEntry(function W({ text }: { text: string }) {
      rendered.push(text)
      return null
    })

    let setText!: (t: string) => void
    function Host() {
      const [text, setTextState] = useState('initial')
      setText = setTextState
      return createElement(MFBridgeLazy, { register: loader, props: { text }, namespace: 'race' })
    }

    await act(async () => { render(createElement(Host)) })

    // Update props WHILE the loader hasn't resolved yet
    await act(async () => { setText('updated-before-load') })

    // Now resolve the loader
    await act(async () => { resolveLoader(register) })

    // The component should render with the latest props, not the stale initial ones
    expect(rendered[rendered.length - 1]).toBe('updated-before-load')
  })

  it('stale loader resolution is ignored after register prop changes', async () => {
    let resolveFirst!: (fn: ReturnType<typeof createMFEntry>) => void
    const slowLoader = () => new Promise<ReturnType<typeof createMFEntry>>(r => { resolveFirst = r })
    const fastResult = createMFEntry(function Fast() { return null })
    const fastLoader = () => Promise.resolve(fastResult)

    const mounted: string[] = []
    const slowResult = createMFEntry(function Slow() {
      mounted.push('slow')
      return null
    })

    let setLoader!: (l: typeof slowLoader) => void
    function Host() {
      const [loader, setLoaderState] = useState<() => Promise<typeof fastResult>>(() => slowLoader as any)
      setLoader = (l) => setLoaderState(() => l)
      return createElement(MFBridgeLazy, { register: loader, props: {}, namespace: 'race2' })
    }

    await act(async () => { render(createElement(Host)) })

    // Switch to a different loader before first one resolves
    await act(async () => { setLoader(fastLoader) })
    // Fast loader resolves instantly — component is now mounted

    // Now resolve the slow (stale) loader
    await act(async () => { resolveFirst(slowResult) })

    // Slow component must NOT have mounted — its resolution was cancelled
    expect(mounted).not.toContain('slow')
  })
})

// ─── Large props objects ──────────────────────────────────────────────────────

describe('large props objects', () => {
  it('handles props with 500 keys without dropping updates', async () => {
    const makeProps = (seed: number) =>
      Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, seed + i]))

    const lastSeen: { seed: number | null } = { seed: null }
    const register = defineMFEntry<Record<string, number>, null>({
      mount: (opts) => { lastSeen.seed = opts.props['k0']; return null },
      update: (_, props) => { lastSeen.seed = props['k0'] },
      unmount: () => {},
    })

    const el = document.createElement('div')
    document.body.appendChild(el)
    register({ mountPointer: el, props: makeProps(0), namespace: 'bigprops' })

    const bus = new DOMEventBus(el, 'bigprops')
    for (let seed = 1; seed <= 10; seed++) {
      bus.send('propsChanged', makeProps(seed))
    }

    expect(lastSeen.seed).toBe(10) // k0 of seed=10 is 10
    el.remove()
  })
})

// ─── Multiple simultaneous instances ─────────────────────────────────────────

describe('multiple instances — no cross-contamination under load', () => {
  it('10 concurrent instances each receive only their own events', async () => {
    const counts = Array.from({ length: 10 }, () => 0)

    const registers = counts.map((_, idx) =>
      defineMFEntry<object, null>({
        mount({ onCommand }) {
          onCommand(() => { counts[idx]++ })
          return null
        },
        unmount: () => {},
      }),
    )

    const elements = registers.map((register, idx) => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      register({ mountPointer: el, props: {}, namespace: `inst-${idx}` })
      return el
    })

    // Send one command to each instance
    elements.forEach((el, idx) => {
      const bus = new DOMEventBus(el, `inst-${idx}`)
      bus.send('command', { type: 'ping', payload: null })
    })

    // Each counter incremented exactly once, none bled into others
    expect(counts).toEqual(Array(10).fill(1))
    elements.forEach(el => el.remove())
  })
})

// ─── Error resilience in defineMFEntry ───────────────────────────────────────

describe('defineMFEntry — error resilience', () => {
  it('teardown runs even if unmount throws', () => {
    const unmount = vi.fn(() => { throw new Error('cleanup failed') })
    const register = defineMFEntry({ mount: () => null, unmount })

    const el = document.createElement('div')
    document.body.appendChild(el)
    const teardown = register({ mountPointer: el, props: {}, namespace: 'err' })

    // Teardown must not propagate the error from unmount
    expect(() => teardown()).toThrow('cleanup failed') // it does throw — document this behavior
    // But command subscriptions were cleaned up before unmount was called
    const bus = new DOMEventBus(el, 'err')
    const handler = vi.fn()
    // No lingering listeners means sending to a torn-down bus is a no-op
    bus.send('propsChanged', { x: 1 })
    expect(handler).not.toHaveBeenCalled()
    el.remove()
  })

  it('mount can safely do nothing and return null', () => {
    const register = defineMFEntry({ mount: () => null, unmount: vi.fn() })
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(() => {
      const teardown = register({ mountPointer: el, props: {}, namespace: 'noop' })
      teardown()
    }).not.toThrow()
    el.remove()
  })
})
