import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createElement, useState } from 'react'
import { createMFEntry } from '../src/entry.js'
import { DOMEventBus } from '../src/dom-event-bus.js'

function Counter({ count }: { count: number }) {
  return createElement('span', { 'data-testid': 'count' }, String(count))
}

describe('createMFEntry', () => {
  let mountPoint: HTMLElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    mountPoint = document.createElement('div')
    document.body.appendChild(mountPoint)
    root = createRoot(mountPoint)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.removeChild(mountPoint)
  })

  it('mounts the component with initial props', async () => {
    const register = createMFEntry(Counter)

    await act(async () => {
      register({ mountPointer: mountPoint, props: { count: 7 } })
    })

    expect(mountPoint.querySelector('[data-testid="count"]')?.textContent).toBe('7')
  })

  it('re-renders on propsChanged event', async () => {
    const register = createMFEntry(Counter)

    await act(async () => {
      register({ mountPointer: mountPoint, props: { count: 1 } })
    })

    const bus = new DOMEventBus(mountPoint, 'mfbridge')
    await act(async () => {
      bus.send('propsChanged', { count: 99 })
    })

    expect(mountPoint.querySelector('[data-testid="count"]')?.textContent).toBe('99')
  })

  it('calls onBeforeMount before first render', async () => {
    const onBeforeMount = vi.fn()
    const register = createMFEntry(Counter, onBeforeMount)

    await act(async () => {
      register({ mountPointer: mountPoint, props: { count: 0 } })
    })

    expect(onBeforeMount).toHaveBeenCalledOnce()
    expect(onBeforeMount).toHaveBeenCalledWith(
      expect.objectContaining({ mountPointer: mountPoint, props: { count: 0 } }),
    )
  })

  it('passes namespace to onBeforeMount', async () => {
    let receivedNs: string | undefined
    const register = createMFEntry(Counter, ({ namespace }) => { receivedNs = namespace })

    await act(async () => {
      register({ mountPointer: mountPoint, props: { count: 0 }, namespace: 'custom-ns' })
    })

    expect(receivedNs).toBe('custom-ns')
  })

  it('passes default namespace to onBeforeMount when none provided', async () => {
    let receivedNs: string | undefined
    const register = createMFEntry(Counter, ({ namespace }) => { receivedNs = namespace })

    await act(async () => {
      register({ mountPointer: mountPoint, props: { count: 0 } })
    })

    expect(receivedNs).toBe('mfbridge')
  })

  it('provides emit in onBeforeMount that dispatches events to the host', async () => {
    let emitFn!: (type: string, payload?: unknown) => void
    const register = createMFEntry(Counter, ({ emit }) => { emitFn = emit })

    await act(async () => {
      register({ mountPointer: mountPoint, props: { count: 0 } })
    })

    const received: Array<{ type: string; payload: unknown }> = []
    const hostBus = new DOMEventBus(mountPoint, 'mfbridge')
    hostBus.on<{ type: string; payload: unknown }>('event', (detail) => received.push(detail))

    emitFn('clicked', { x: 1 })

    expect(received).toEqual([{ type: 'clicked', payload: { x: 1 } }])
  })

  it('emit uses the correct namespace when a custom one is provided', async () => {
    let emitFn!: (type: string, payload?: unknown) => void
    const register = createMFEntry(Counter, ({ emit }) => { emitFn = emit })

    await act(async () => {
      register({ mountPointer: mountPoint, props: { count: 0 }, namespace: 'myns' })
    })

    const defaultReceived: unknown[] = []
    const customReceived: Array<{ type: string }> = []

    new DOMEventBus(mountPoint, 'mfbridge').on<{ type: string }>('event', (d) => defaultReceived.push(d))
    new DOMEventBus(mountPoint, 'myns').on<{ type: string }>('event', (d) => customReceived.push(d))

    emitFn('ping')

    expect(defaultReceived).toHaveLength(0)
    expect(customReceived).toHaveLength(1)
    expect(customReceived[0].type).toBe('ping')
  })

  it('unmounts cleanly and stops listening', async () => {
    const register = createMFEntry(Counter)
    let unmount!: () => void

    await act(async () => {
      unmount = register({ mountPointer: mountPoint, props: { count: 5 } })
    })

    act(() => { unmount() })

    // After unmount, propsChanged should no longer cause renders
    const bus = new DOMEventBus(mountPoint, 'mfbridge')
    await act(async () => {
      bus.send('propsChanged', { count: 999 })
    })

    // Container should be empty after unmount
    expect(mountPoint.innerHTML).toBe('')
  })

  it('calls onBeforeUnmount before unmounting', async () => {
    const onBeforeUnmount = vi.fn()
    const register = createMFEntry(Counter, undefined, onBeforeUnmount)
    let unmount!: () => void

    await act(async () => {
      unmount = register({ mountPointer: mountPoint, props: { count: 0 } })
    })

    expect(onBeforeUnmount).not.toHaveBeenCalled()

    act(() => { unmount() })

    expect(onBeforeUnmount).toHaveBeenCalledOnce()
    expect(onBeforeUnmount).toHaveBeenCalledWith({ mountPointer: mountPoint })
  })

  it('returns a no-op unmount when called without DOM (SSR guard)', () => {
    const mp = document.createElement('div')
    const register = createMFEntry(Counter)

    const savedDoc = (globalThis as any).document
    delete (globalThis as any).document

    try {
      const unmount = register({ mountPointer: mp, props: { count: 0 } })
      expect(typeof unmount).toBe('function')
      expect(() => unmount()).not.toThrow()
    } finally {
      (globalThis as any).document = savedDoc
    }
  })

  it('calls onError when the component throws during render', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    function Broken(): never { throw new Error('render crash') }

    const onError = vi.fn()
    const register = createMFEntry(Broken as any, undefined, undefined, onError)

    await act(async () => {
      register({ mountPointer: mountPoint, props: {} })
    })

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    vi.restoreAllMocks()
  })

  it('renders null and does not crash when component throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    function Broken(): never { throw new Error('crash') }

    const register = createMFEntry(Broken as any)

    await act(async () => {
      register({ mountPointer: mountPoint, props: {} })
    })

    expect(mountPoint.innerHTML).toBe('')
    vi.restoreAllMocks()
  })

  it('resets error boundary on next propsChanged so a recovered component can re-render', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    let shouldThrow = true
    function Flaky({ count }: { count: number }) {
      if (shouldThrow) throw new Error('flaky')
      return createElement('span', { 'data-testid': 'count' }, String(count))
    }

    const register = createMFEntry(Flaky)

    await act(async () => {
      register({ mountPointer: mountPoint, props: { count: 1 } })
    })

    expect(mountPoint.innerHTML).toBe('') // crashed → null

    shouldThrow = false
    const bus = new DOMEventBus(mountPoint, 'mfbridge')
    await act(async () => {
      bus.send('propsChanged', { count: 42 })
    })

    expect(mountPoint.querySelector('[data-testid="count"]')?.textContent).toBe('42')
    vi.restoreAllMocks()
  })

  it('provides onCommand in onBeforeMount that receives host-sent commands', async () => {
    const received: Array<{ type: string; payload: unknown }> = []

    const register = createMFEntry(Counter, ({ onCommand }) => {
      onCommand((type, payload) => received.push({ type, payload }))
    })

    await act(async () => {
      register({ mountPointer: mountPoint, props: { count: 0 } })
    })

    const bus = new DOMEventBus(mountPoint, 'mfbridge')
    act(() => { bus.send('command', { type: 'reset', payload: { keepEmail: true } }) })

    expect(received).toEqual([{ type: 'reset', payload: { keepEmail: true } }])
  })

  it('onCommand uses the correct namespace', async () => {
    const defaultReceived: unknown[] = []
    const customReceived: unknown[] = []

    const register = createMFEntry(Counter, ({ onCommand }) => {
      onCommand((type) => customReceived.push(type))
    })

    await act(async () => {
      register({ mountPointer: mountPoint, props: { count: 0 }, namespace: 'myns' })
    })

    new DOMEventBus(mountPoint, 'mfbridge').on('command', (d) => defaultReceived.push(d))
    const bus = new DOMEventBus(mountPoint, 'myns')
    act(() => { bus.send('command', { type: 'ping', payload: undefined }) })

    expect(defaultReceived).toHaveLength(0)
    expect(customReceived).toEqual(['ping'])
  })

  it('uses a custom namespace when provided', async () => {
    const register = createMFEntry(Counter)

    await act(async () => {
      register({ mountPointer: mountPoint, props: { count: 0 }, namespace: 'custom' })
    })

    const defaultBus = new DOMEventBus(mountPoint, 'mfbridge')
    const customBus = new DOMEventBus(mountPoint, 'custom')

    // Default namespace should NOT trigger re-render
    await act(async () => {
      defaultBus.send('propsChanged', { count: 11 })
    })
    expect(mountPoint.querySelector('[data-testid="count"]')?.textContent).toBe('0')

    // Custom namespace SHOULD trigger re-render
    await act(async () => {
      customBus.send('propsChanged', { count: 22 })
    })
    expect(mountPoint.querySelector('[data-testid="count"]')?.textContent).toBe('22')
  })
})
