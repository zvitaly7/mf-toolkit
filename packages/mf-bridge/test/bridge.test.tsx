import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createElement, useRef, useState } from 'react'
import { createMFEntry } from '../src/entry.js'
import { DOMEventBus } from '../src/dom-event-bus.js'
import { MFBridge, MFBridgeLazy, preloadMF } from '../src/host.js'

afterEach(cleanup)

function Label({ text }: { text: string }) {
  return createElement('span', { 'data-testid': 'label' }, text)
}

const labelRegister = createMFEntry(Label)

// ─── MFBridge ─────────────────────────────────────────────────────────────

describe('MFBridge', () => {
  it('mounts the remote component', async () => {
    await act(async () => {
      render(createElement(MFBridge, { register: labelRegister, props: { text: 'hello' } }))
    })

    expect(screen.getByTestId('label').textContent).toBe('hello')
  })

  it('streams prop updates to the remote component', async () => {
    const { rerender } = await act(async () =>
      render(createElement(MFBridge, { register: labelRegister, props: { text: 'v1' } })),
    )

    await act(async () => {
      rerender(createElement(MFBridge, { register: labelRegister, props: { text: 'v2' } }))
    })

    expect(screen.getByTestId('label').textContent).toBe('v2')
  })

  it('does not send propsChanged when parent re-renders with the same props reference', async () => {
    const sendSpy = vi.fn()
    const stableProps = { text: 'stable' }

    // Wrapper that re-renders MFBridge with the same props object but different parent state
    function Wrapper() {
      const [tick, setTick] = useState(0)
      // expose setTick so we can trigger re-renders from outside
      ;(Wrapper as any)._setTick = setTick
      return createElement(MFBridge, { register: labelRegister, props: stableProps })
    }

    await act(async () => { render(createElement(Wrapper)) })

    // Patch the bus send method after mount to spy on it
    const container = screen.getByTestId('label').closest('mf-bridge') as HTMLElement
    container.addEventListener = new Proxy(container.addEventListener, { apply: () => {} })

    const dispatchSpy = vi.spyOn(container, 'dispatchEvent')

    // Trigger a parent re-render without changing props
    await act(async () => { ;(Wrapper as any)._setTick?.((n: number) => n + 1) })

    // dispatchEvent should NOT have been called because props reference didn't change
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('calls onEvent when the remote emits a custom event', async () => {
    const onEvent = vi.fn()

    await act(async () => {
      render(createElement(MFBridge, { register: labelRegister, props: { text: 'hi' }, onEvent }))
    })

    const container = screen.getByTestId('label').closest('mf-bridge') as HTMLElement
    const bus = new DOMEventBus(container, 'mfbridge')

    await act(async () => {
      bus.send('event', { type: 'clicked', payload: { x: 1 } })
    })

    expect(onEvent).toHaveBeenCalledWith('clicked', { x: 1 })
  })

  it('does not throw when onEvent is not provided and remote emits', async () => {
    await act(async () => {
      render(createElement(MFBridge, { register: labelRegister, props: { text: 'hi' } }))
    })

    const container = screen.getByTestId('label').closest('mf-bridge') as HTMLElement
    const bus = new DOMEventBus(container, 'mfbridge')

    await expect(act(async () => {
      bus.send('event', { type: 'ping', payload: null })
    })).resolves.not.toThrow()
  })
})

// ─── MFBridgeLazy ─────────────────────────────────────────────────────────

describe('MFBridgeLazy', () => {
  it('shows fallback while loading', async () => {
    let resolve!: (fn: typeof labelRegister) => void
    const loader = () => new Promise<typeof labelRegister>((res) => { resolve = res })

    render(
      createElement(MFBridgeLazy, {
        register: loader,
        props: { text: 'world' },
        fallback: createElement('span', { 'data-testid': 'fb' }, 'loading…'),
      }),
    )

    expect(screen.getByTestId('fb').textContent).toBe('loading…')

    await act(async () => { resolve(labelRegister) })
  })

  it('mounts the remote component after load resolves', async () => {
    const loader = () => Promise.resolve(labelRegister)

    await act(async () => {
      render(createElement(MFBridgeLazy, { register: loader, props: { text: 'loaded' } }))
    })

    expect(screen.getByTestId('label').textContent).toBe('loaded')
  })

  it('streams prop updates after load', async () => {
    const loader = () => Promise.resolve(labelRegister)

    const { rerender } = await act(async () =>
      render(createElement(MFBridgeLazy, { register: loader, props: { text: 'a' } })),
    )

    await act(async () => {
      rerender(createElement(MFBridgeLazy, { register: loader, props: { text: 'b' } }))
    })

    expect(screen.getByTestId('label').textContent).toBe('b')
  })

  it('does not mount if unmounted before load resolves', async () => {
    let resolve!: (fn: typeof labelRegister) => void
    const loader = () => new Promise<typeof labelRegister>((res) => { resolve = res })
    const onBeforeMount = vi.fn()
    const guardedRegister = createMFEntry(Label, onBeforeMount)

    const { unmount } = render(
      createElement(MFBridgeLazy, { register: loader, props: { text: 'x' } }),
    )

    act(() => { unmount() })

    await act(async () => { resolve(guardedRegister) })

    expect(onBeforeMount).not.toHaveBeenCalled()
  })

  it('calls onLoad after successful load', async () => {
    const loader = () => Promise.resolve(labelRegister)
    const onLoad = vi.fn()

    await act(async () => {
      render(createElement(MFBridgeLazy, { register: loader, props: { text: 'hi' }, onLoad }))
    })

    expect(onLoad).toHaveBeenCalledOnce()
  })

  it('does not call onLoad when load fails', async () => {
    const loader = () => Promise.reject(new Error('fail'))
    const onLoad = vi.fn()

    await act(async () => {
      render(createElement(MFBridgeLazy, { register: loader, props: { text: 'x' }, onLoad }))
    })

    expect(onLoad).not.toHaveBeenCalled()
  })

  it('remounts when register factory changes', async () => {
    const loaderA = () => Promise.resolve(labelRegister)
    const loaderB = () => Promise.resolve(labelRegister)

    const { rerender } = await act(async () =>
      render(createElement(MFBridgeLazy, { register: loaderA, props: { text: 'from-a' } })),
    )

    expect(screen.getByTestId('label').textContent).toBe('from-a')

    await act(async () => {
      rerender(createElement(MFBridgeLazy, { register: loaderB, props: { text: 'from-b' } }))
    })

    expect(screen.getByTestId('label').textContent).toBe('from-b')
  })

  it('calls onError and shows fallback when register rejects', async () => {
    const error = new Error('chunk load failed')
    const loader = () => Promise.reject(error)
    const onError = vi.fn()

    await act(async () => {
      render(
        createElement(MFBridgeLazy, {
          register: loader,
          props: { text: 'x' },
          fallback: createElement('span', { 'data-testid': 'fb' }, 'unavailable'),
          onError,
        }),
      )
    })

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0]).toBe(error)
    expect(typeof onError.mock.calls[0][1]).toBe('function') // retry callback
    expect(screen.getByTestId('fb').textContent).toBe('unavailable')
    expect(screen.queryByTestId('label')).toBeNull()
  })

  it('stays on fallback after load failure, does not mount remote', async () => {
    const loader = () => Promise.reject(new Error('network error'))

    await act(async () => {
      render(
        createElement(MFBridgeLazy, {
          register: loader,
          props: { text: 'x' },
          fallback: createElement('span', { 'data-testid': 'fb' }, 'fallback'),
        }),
      )
    })

    expect(screen.getByTestId('fb')).toBeTruthy()
    expect(screen.queryByTestId('label')).toBeNull()
  })

  it('forwards onEvent to the remote after load', async () => {
    const onEvent = vi.fn()
    const loader = () => Promise.resolve(labelRegister)

    await act(async () => {
      render(createElement(MFBridgeLazy, { register: loader, props: { text: 'hi' }, onEvent }))
    })

    const container = screen.getByTestId('label').closest('mf-bridge') as HTMLElement
    const bus = new DOMEventBus(container, 'mfbridge')

    await act(async () => {
      bus.send('event', { type: 'action', payload: 42 })
    })

    expect(onEvent).toHaveBeenCalledWith('action', 42)
  })
})

// ─── onError retry ────────────────────────────────────────────────────────

describe('onError retry', () => {
  afterEach(cleanup)

  it('passes a retry function to onError that triggers a fresh load', async () => {
    let attempt = 0
    const loader = () => {
      attempt++
      return attempt === 1
        ? Promise.reject(new Error('first fail'))
        : Promise.resolve(labelRegister)
    }
    const onError = vi.fn()

    await act(async () => {
      render(createElement(MFBridgeLazy, {
        register: loader,
        props: { text: 'retried' },
        onError,
        fallback: createElement('span', { 'data-testid': 'fb' }, 'loading'),
      }))
    })

    expect(onError).toHaveBeenCalledOnce()
    expect(screen.getByTestId('fb')).toBeTruthy()

    const retry = onError.mock.calls[0][1] as () => void

    await act(async () => { retry() })

    expect(attempt).toBe(2)
    expect(screen.getByTestId('label').textContent).toBe('retried')
  })

  it('shows fallback during manual retry then mounts on success', async () => {
    let attempt = 0
    const loader = () => {
      attempt++
      return attempt < 2 ? Promise.reject(new Error('fail')) : Promise.resolve(labelRegister)
    }
    let retryFn!: () => void
    const onError = vi.fn((_err: unknown, retry: () => void) => { retryFn = retry })

    await act(async () => {
      render(createElement(MFBridgeLazy, {
        register: loader,
        props: { text: 'ok' },
        onError,
        fallback: createElement('span', { 'data-testid': 'fb' }, 'fb'),
      }))
    })

    expect(screen.getByTestId('fb')).toBeTruthy()
    expect(screen.queryByTestId('label')).toBeNull()

    await act(async () => { retryFn() })

    expect(screen.getByTestId('label').textContent).toBe('ok')
    expect(screen.queryByTestId('fb')).toBeNull()
  })

  it('bypasses preload cache on manual retry', async () => {
    let attempt = 0
    const loader = () => {
      attempt++
      return attempt === 1 ? Promise.reject(new Error('fail')) : Promise.resolve(labelRegister)
    }

    // Warm the cache with the failing promise
    preloadMF(loader)

    let retryFn!: () => void
    const onError = vi.fn((_err: unknown, retry: () => void) => { retryFn = retry })

    await act(async () => {
      render(createElement(MFBridgeLazy, {
        register: loader,
        props: { text: 'fresh' },
        onError,
      }))
    })

    expect(attempt).toBe(1)

    await act(async () => { retryFn() })

    expect(attempt).toBe(2)
    expect(screen.getByTestId('label').textContent).toBe('fresh')
  })
})

// ─── timeout ──────────────────────────────────────────────────────────────

describe('timeout', () => {
  afterEach(() => { vi.useRealTimers(); cleanup() })

  it('triggers failure when load exceeds timeout', async () => {
    vi.useFakeTimers()

    // Loader that never resolves
    const loader = () => new Promise<typeof labelRegister>(() => {})
    const onError = vi.fn()

    act(() => {
      render(createElement(MFBridgeLazy, {
        register: loader,
        props: { text: 'x' },
        timeout: 1000,
        onError,
        fallback: createElement('span', { 'data-testid': 'fb' }, 'timeout'),
      }))
    })

    await act(async () => { vi.advanceTimersByTime(1001) })

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
    expect((onError.mock.calls[0][0] as Error).message).toContain('timed out')
    expect(screen.getByTestId('fb')).toBeTruthy()
    expect(screen.queryByTestId('label')).toBeNull()
  })

  it('does not trigger timeout when load resolves in time', async () => {
    vi.useFakeTimers()

    let resolveLoader!: (fn: typeof labelRegister) => void
    const loader = () => new Promise<typeof labelRegister>((res) => { resolveLoader = res })
    const onError = vi.fn()

    act(() => {
      render(createElement(MFBridgeLazy, {
        register: loader,
        props: { text: 'fast' },
        timeout: 2000,
        onError,
      }))
    })

    // Resolve before timeout fires
    await act(async () => { resolveLoader(labelRegister) })

    vi.advanceTimersByTime(3000)

    expect(onError).not.toHaveBeenCalled()
    expect(screen.getByTestId('label').textContent).toBe('fast')
  })

  it('retries after timeout when retryCount is set', async () => {
    vi.useFakeTimers()

    let attempt = 0
    let resolveSecond!: (fn: typeof labelRegister) => void

    const loader = () => {
      attempt++
      if (attempt === 1) return new Promise<typeof labelRegister>(() => {}) // hangs
      return new Promise<typeof labelRegister>((res) => { resolveSecond = res })
    }

    act(() => {
      render(createElement(MFBridgeLazy, {
        register: loader,
        props: { text: 'recovered' },
        timeout: 500,
        retryCount: 1,
      }))
    })

    // Fire the timeout for attempt 1
    await act(async () => { vi.advanceTimersByTime(501) })

    expect(attempt).toBe(2)

    // Resolve attempt 2
    await act(async () => { resolveSecond(labelRegister) })

    expect(screen.getByTestId('label').textContent).toBe('recovered')
  })
})

// ─── onStatusChange ───────────────────────────────────────────────────────

describe('onStatusChange', () => {
  afterEach(cleanup)

  it('reports loading → ready on successful load', async () => {
    const statuses: string[] = []
    const loader = () => Promise.resolve(labelRegister)

    await act(async () => {
      render(createElement(MFBridgeLazy, {
        register: loader,
        props: { text: 'x' },
        onStatusChange: (s) => statuses.push(s),
      }))
    })

    expect(statuses).toEqual(['loading', 'ready'])
  })

  it('reports loading → error on failure', async () => {
    const statuses: string[] = []
    const loader = () => Promise.reject(new Error('fail'))

    await act(async () => {
      render(createElement(MFBridgeLazy, {
        register: loader,
        props: { text: 'x' },
        onStatusChange: (s) => statuses.push(s),
      }))
    })

    expect(statuses).toEqual(['loading', 'error'])
  })

  it('reports loading again after manual retry', async () => {
    const statuses: string[] = []
    let attempt = 0
    const loader = () => {
      attempt++
      return attempt === 1 ? Promise.reject(new Error('fail')) : Promise.resolve(labelRegister)
    }
    let retryFn!: () => void
    const onError = (_err: unknown, retry: () => void) => { retryFn = retry }

    await act(async () => {
      render(createElement(MFBridgeLazy, {
        register: loader,
        props: { text: 'x' },
        onStatusChange: (s) => statuses.push(s),
        onError,
      }))
    })

    expect(statuses).toEqual(['loading', 'error'])

    await act(async () => { retryFn() })

    expect(statuses).toEqual(['loading', 'error', 'loading', 'ready'])
  })

  it('reports loading and ready for each loader swap', async () => {
    const statuses: string[] = []
    const loaderA = () => Promise.resolve(labelRegister)
    const loaderB = () => Promise.resolve(labelRegister)

    const { rerender } = await act(async () =>
      render(createElement(MFBridgeLazy, {
        register: loaderA,
        props: { text: 'a' },
        onStatusChange: (s) => statuses.push(s),
      })),
    )

    await act(async () => {
      rerender(createElement(MFBridgeLazy, {
        register: loaderB,
        props: { text: 'b' },
        onStatusChange: (s) => statuses.push(s),
      }))
    })

    expect(statuses).toEqual(['loading', 'ready', 'loading', 'ready'])
  })
})

// ─── debug ─────────────────────────────────────────────────────────────────

describe('debug mode', () => {
  beforeEach(() => { vi.spyOn(console, 'debug').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks(); cleanup() })

  it('logs mount and unmount events for MFBridge', async () => {
    const { unmount } = await act(async () =>
      render(createElement(MFBridge, { register: labelRegister, props: { text: 'x' }, debug: true })),
    )

    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('mf-bridge'),
      'mount',
      expect.anything(),
    )

    act(() => { unmount() })

    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('mf-bridge'),
      'unmount',
    )
  })

  it('logs propsChanged when props update', async () => {
    const { rerender } = await act(async () =>
      render(createElement(MFBridge, { register: labelRegister, props: { text: 'a' }, debug: true })),
    )

    await act(async () => {
      rerender(createElement(MFBridge, { register: labelRegister, props: { text: 'b' }, debug: true }))
    })

    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('mf-bridge'),
      'propsChanged',
      expect.objectContaining({ text: 'b' }),
    )
  })

  it('logs load:start and load:ok for MFBridgeLazy', async () => {
    const loader = () => Promise.resolve(labelRegister)

    await act(async () => {
      render(createElement(MFBridgeLazy, { register: loader, props: { text: 'x' }, debug: true }))
    })

    expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('mf-bridge'), 'load:start')
    expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('mf-bridge'), 'load:ok')
  })

  it('logs load:error on failure', async () => {
    const err = new Error('fail')
    const loader = () => Promise.reject(err)

    await act(async () => {
      render(createElement(MFBridgeLazy, { register: loader, props: { text: 'x' }, debug: true }))
    })

    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining('mf-bridge'),
      'load:error',
      err,
    )
  })

  it('does not log when debug is false', async () => {
    await act(async () => {
      render(createElement(MFBridge, { register: labelRegister, props: { text: 'x' } }))
    })

    expect(console.debug).not.toHaveBeenCalled()
  })
})

// ─── preloadMF ─────────────────────────────────────────────────────────────

describe('preloadMF', () => {
  afterEach(cleanup)

  it('starts the load before render', async () => {
    let callCount = 0
    const loader = () => { callCount++; return Promise.resolve(labelRegister) }

    preloadMF(loader)
    expect(callCount).toBe(1)

    await act(async () => {
      render(createElement(MFBridgeLazy, { register: loader, props: { text: 'pre' } }))
    })

    // loader must have been called exactly once — render reused the cached promise
    expect(callCount).toBe(1)
    expect(screen.getByTestId('label').textContent).toBe('pre')
  })

  it('does not call loader twice when called multiple times with same reference', () => {
    let callCount = 0
    const loader = () => { callCount++; return Promise.resolve(labelRegister) }

    preloadMF(loader)
    preloadMF(loader)

    expect(callCount).toBe(1)
  })
})

// ─── retry ─────────────────────────────────────────────────────────────────

describe('retry', () => {
  afterEach(cleanup)

  it('mounts successfully after transient failures', async () => {
    let attempt = 0
    const loader = () => {
      attempt++
      return attempt < 3 ? Promise.reject(new Error(`fail ${attempt}`)) : Promise.resolve(labelRegister)
    }

    await act(async () => {
      render(createElement(MFBridgeLazy, { register: loader, props: { text: 'ok' }, retryCount: 2 }))
    })

    expect(attempt).toBe(3)
    expect(screen.getByTestId('label').textContent).toBe('ok')
  })

  it('calls onError only after all retries are exhausted', async () => {
    const error = new Error('always fails')
    let attempt = 0
    const loader = () => { attempt++; return Promise.reject(error) }
    const onError = vi.fn()

    await act(async () => {
      render(createElement(MFBridgeLazy, {
        register: loader,
        props: { text: 'x' },
        retryCount: 2,
        onError,
      }))
    })

    expect(attempt).toBe(3) // 1 initial + 2 retries
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0]).toBe(error)
  })

  it('shows fallback throughout retries and after final failure', async () => {
    const loader = () => Promise.reject(new Error('fail'))

    await act(async () => {
      render(createElement(MFBridgeLazy, {
        register: loader,
        props: { text: 'x' },
        retryCount: 1,
        fallback: createElement('span', { 'data-testid': 'fb' }, 'loading'),
      }))
    })

    expect(screen.getByTestId('fb')).toBeTruthy()
    expect(screen.queryByTestId('label')).toBeNull()
  })

  it('clears preload cache on retry so fresh requests are made', async () => {
    let attempt = 0
    const loader = () => {
      attempt++
      return attempt === 1 ? Promise.reject(new Error('first try')) : Promise.resolve(labelRegister)
    }

    // Warm the cache with the first (failing) promise
    preloadMF(loader)

    await act(async () => {
      render(createElement(MFBridgeLazy, { register: loader, props: { text: 'fresh' }, retryCount: 1 }))
    })

    expect(attempt).toBe(2) // preload (fail) + retry (success)
    expect(screen.getByTestId('label').textContent).toBe('fresh')
  })
})
