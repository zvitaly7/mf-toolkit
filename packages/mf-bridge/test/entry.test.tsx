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
    expect(onBeforeMount).toHaveBeenCalledWith({ mountPointer: mountPoint, props: { count: 0 } })
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
