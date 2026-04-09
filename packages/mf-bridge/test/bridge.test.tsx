import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
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
})
