// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createElement, useRef, useState } from 'react'
import { createMFEntry } from '../src/entry.js'
import { MFBridge, MFBridgeLazy } from '../src/host.js'

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
    expect(onError).toHaveBeenCalledWith(error)
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
})
