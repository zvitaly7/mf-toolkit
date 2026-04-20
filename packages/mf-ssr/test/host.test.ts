/**
 * @vitest-environment jsdom
 *
 * Tests for MFBridgeSSR — the main client-boundary SSR component.
 * Covers loader mode (React.lazy) and url mode (fetch + DOMEventBus bridge).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createElement, useState } from 'react'
import { MFBridgeSSR, __clearFragmentCache } from '../src/host.js'
import { DOMEventBus } from '@mf-toolkit/mf-bridge'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  __clearFragmentCache()
})

// ─── loader mode ─────────────────────────────────────────────────────────────

describe('MFBridgeSSR — loader mode', () => {
  it('loads and renders the remote component with props', async () => {
    function Widget({ label }: { label: string }) {
      return createElement('span', { 'data-testid': 'widget' }, label)
    }

    const { findByTestId } = render(
      createElement(MFBridgeSSR, {
        loader: () => Promise.resolve(Widget),
        props: { label: 'hello' },
        fallback: createElement('span', { 'data-testid': 'fallback' }, 'loading'),
      }),
    )

    const el = await findByTestId('widget')
    expect(el.textContent).toBe('hello')
  })

  it('renders fallback while loader is pending', async () => {
    let resolve!: (c: any) => void
    const loader = () => new Promise<any>((r) => { resolve = r })

    const { getByTestId, findByTestId } = render(
      createElement(MFBridgeSSR, {
        loader,
        props: {},
        fallback: createElement('span', { 'data-testid': 'fallback' }, 'loading'),
      }),
    )

    expect(getByTestId('fallback').textContent).toBe('loading')

    await act(async () => {
      resolve(() => createElement('span', { 'data-testid': 'ready' }, 'done'))
    })

    expect((await findByTestId('ready')).textContent).toBe('done')
  })

  it('updates props when parent re-renders (auto-streaming, no bridge needed)', async () => {
    function Display({ value }: { value: string }) {
      return createElement('span', { 'data-testid': 'display' }, value)
    }
    const loader = () => Promise.resolve(Display)

    let setValue!: (v: string) => void
    function Parent() {
      const [v, setV] = useState('a')
      setValue = setV
      return createElement(MFBridgeSSR, { loader, props: { value: v } })
    }

    const { findByTestId } = render(createElement(Parent))
    expect((await findByTestId('display')).textContent).toBe('a')

    await act(async () => { setValue('b') })
    expect((await findByTestId('display')).textContent).toBe('b')

    await act(async () => { setValue('c') })
    expect((await findByTestId('display')).textContent).toBe('c')
  })

  it('renders errorFallback when loader rejects', async () => {
    const { findByTestId } = render(
      createElement(MFBridgeSSR, {
        loader: () => Promise.reject(new Error('boom')),
        props: {},
        errorFallback: createElement('span', { 'data-testid': 'err' }, 'failed'),
      }),
    )

    expect((await findByTestId('err')).textContent).toBe('failed')
  })

  it('falls back to fallback when errorFallback is not provided and loader rejects', async () => {
    const { findByTestId } = render(
      createElement(MFBridgeSSR, {
        loader: () => Promise.reject(new Error('boom')),
        props: {},
        fallback: createElement('span', { 'data-testid': 'fb' }, 'generic'),
      }),
    )

    expect((await findByTestId('fb')).textContent).toBe('generic')
  })

  it('renders errorFallback when loader exceeds timeout', async () => {
    const neverResolves = () => new Promise<any>(() => {})

    const { findByTestId } = render(
      createElement(MFBridgeSSR, {
        loader: neverResolves,
        props: {},
        timeout: 10,
        errorFallback: createElement('span', { 'data-testid': 'to' }, 'timed-out'),
      }),
    )

    expect((await findByTestId('to')).textContent).toBe('timed-out')
  })
})

// ─── url mode ────────────────────────────────────────────────────────────────

const FRAG_HTML =
  '<div data-mf-ssr="W"><script type="application/json" data-mf-props="">{"n":1}</script><div data-mf-app=""><span>content</span></div></div>'

describe('MFBridgeSSR — url mode', () => {
  it('fetches fragment HTML and injects it via dangerouslySetInnerHTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, text: () => Promise.resolve(FRAG_HTML),
    }))

    const { container, findByText } = render(
      createElement(MFBridgeSSR, {
        url: 'http://frag/',
        props: { n: 1 },
        namespace: 'checkout',
      }),
    )

    await findByText('content')
    const host = container.querySelector('[data-mf-host]') as HTMLElement
    expect(host).toBeTruthy()
    expect(host.getAttribute('data-mf-namespace')).toBe('checkout')
    expect(host.innerHTML).toContain('data-mf-ssr="W"')
  })

  it('encodes initial props as JSON in the fetch URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, text: () => Promise.resolve(FRAG_HTML),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { findByText } = render(
      createElement(MFBridgeSSR, {
        url: 'http://frag/',
        props: { key: 'val' },
        namespace: 'ns',
      }),
    )
    await findByText('content')

    const calledUrl: string = fetchMock.mock.calls[0][0]
    expect(calledUrl).toContain('?props=')
    expect(JSON.parse(decodeURIComponent(calledUrl.split('props=')[1]))).toEqual({ key: 'val' })
  })

  it('dispatches propsChanged on [data-mf-namespace] when parent updates props', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, text: () => Promise.resolve(FRAG_HTML),
    }))

    const received: unknown[] = []

    let setStep!: (s: string) => void
    function Parent() {
      const [step, setS] = useState('summary')
      setStep = setS
      return createElement(MFBridgeSSR, {
        url: 'http://frag/',
        props: { orderId: '1', step },
        namespace: 'stream-ns',
      })
    }

    const { container, findByText } = render(createElement(Parent))
    await findByText('content')

    const host = container.querySelector('[data-mf-host]') as HTMLElement
    const bus = new DOMEventBus(host, 'stream-ns')
    bus.on<object>('propsChanged', (p) => received.push(p))

    await act(async () => { setStep('payment') })
    expect(received).toEqual([{ orderId: '1', step: 'payment' }])

    await act(async () => { setStep('confirmation') })
    expect(received).toEqual([
      { orderId: '1', step: 'payment' },
      { orderId: '1', step: 'confirmation' },
    ])
  })

  it('does not dispatch propsChanged on the initial effect pass', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, text: () => Promise.resolve(FRAG_HTML),
    }))

    const received: unknown[] = []

    const { container, findByText } = render(
      createElement(MFBridgeSSR, {
        url: 'http://frag/',
        props: { x: 1 },
        namespace: 'no-init',
      }),
    )
    await findByText('content')

    const host = container.querySelector('[data-mf-host]') as HTMLElement
    const bus = new DOMEventBus(host, 'no-init')
    bus.on('propsChanged', (p) => received.push(p))

    // No parent update triggered — nothing should have fired.
    expect(received).toEqual([])
  })

  it('does not re-fetch HTML when props change (bridge handles updates)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, text: () => Promise.resolve(FRAG_HTML),
    })
    vi.stubGlobal('fetch', fetchMock)

    let setV!: (v: number) => void
    function Parent() {
      const [v, setValue] = useState(1)
      setV = setValue
      return createElement(MFBridgeSSR, {
        url: 'http://frag/',
        props: { v },
        namespace: 'refetch',
      })
    }

    const { findByText } = render(createElement(Parent))
    await findByText('content')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { setV(2) })
    await act(async () => { setV(3) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forwards remote-emitted events via onEvent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, text: () => Promise.resolve(FRAG_HTML),
    }))

    const onEvent = vi.fn()
    const { container, findByText } = render(
      createElement(MFBridgeSSR, {
        url: 'http://frag/',
        props: {},
        namespace: 'evt',
        onEvent,
      }),
    )
    await findByText('content')

    const host = container.querySelector('[data-mf-host]') as HTMLElement
    const bus = new DOMEventBus(host, 'evt')
    bus.send('event', { type: 'orderPlaced', payload: { id: 7 } })

    expect(onEvent).toHaveBeenCalledWith('orderPlaced', { id: 7 })
  })

  it('populates commandRef after mount; clears on unmount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, text: () => Promise.resolve(FRAG_HTML),
    }))

    const commandRef = { current: null as ((t: string, p?: unknown) => void) | null }
    const { findByText, unmount } = render(
      createElement(MFBridgeSSR, {
        url: 'http://frag/',
        props: {},
        namespace: 'cmd',
        commandRef,
      }),
    )
    await findByText('content')

    expect(typeof commandRef.current).toBe('function')
    await act(async () => { unmount() })
    expect(commandRef.current).toBeNull()
  })

  it('renders errorFallback when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))

    const { findByTestId } = render(
      createElement(MFBridgeSSR, {
        url: 'http://frag/',
        props: {},
        errorFallback: createElement('span', { 'data-testid': 'err' }, 'failed'),
      }),
    )
    expect((await findByTestId('err')).textContent).toBe('failed')
  })

  it('renders errorFallback when response status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 503, text: vi.fn(),
    }))

    const { findByTestId } = render(
      createElement(MFBridgeSSR, {
        url: 'http://frag/',
        props: {},
        errorFallback: createElement('span', { 'data-testid': 'err' }, '503'),
      }),
    )
    expect((await findByTestId('err')).textContent).toBe('503')
  })

  it('renders errorFallback when props payload exceeds 4096-char URL limit', async () => {
    // Fetch should NOT be called — error fires synchronously before the request.
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { findByTestId } = render(
      createElement(MFBridgeSSR, {
        url: 'http://frag/',
        // ~5 KB of data, far over the 4 096-char guard
        props: { huge: 'x'.repeat(5000) },
        errorFallback: createElement('span', { 'data-testid': 'err' }, 'too-large'),
      }),
    )
    expect((await findByTestId('err')).textContent).toBe('too-large')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards fetchOptions headers to the fragment fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, text: () => Promise.resolve(FRAG_HTML),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { findByText } = render(
      createElement(MFBridgeSSR, {
        url: 'http://frag/',
        props: { n: 1 },
        namespace: 'fwd',
        fetchOptions: { headers: { authorization: 'Bearer tok', 'x-request-id': 'abc' } },
      }),
    )
    await findByText('content')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer tok')
    expect(headers['x-request-id']).toBe('abc')
  })

  it('calls onError with the thrown error when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))

    const onError = vi.fn()
    const { findByTestId } = render(
      createElement(MFBridgeSSR, {
        url: 'http://frag/',
        props: {},
        onError,
        errorFallback: createElement('span', { 'data-testid': 'err' }, 'failed'),
      }),
    )
    await findByTestId('err')
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  it('calls onError in loader mode when loader rejects', async () => {
    const onError = vi.fn()
    const { findByTestId } = render(
      createElement(MFBridgeSSR, {
        loader: () => Promise.reject(new Error('load-fail')),
        props: {},
        onError,
        errorFallback: createElement('span', { 'data-testid': 'err' }, 'failed'),
      }),
    )
    await findByTestId('err')
    expect(onError).toHaveBeenCalledOnce()
  })

  it('uses separate cache slots for different cacheKey values', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, text: () => Promise.resolve(FRAG_HTML),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { findByText: find1 } = render(
      createElement(MFBridgeSSR, { url: 'http://frag/', props: { n: 1 }, namespace: 'a', cacheKey: 'user-1' }),
    )
    await find1('content')
    cleanup()

    __clearFragmentCache()
    const { findByText: find2 } = render(
      createElement(MFBridgeSSR, { url: 'http://frag/', props: { n: 1 }, namespace: 'b', cacheKey: 'user-2' }),
    )
    await find2('content')

    // Two different cacheKeys → two separate fetches
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
