import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { _MFBridgeSSRFetcher } from '../src/host.js'

const FRAG_HTML = '<div data-mf-ssr="W"><script type="application/json" data-mf-props="">{"n":1}</script><div data-mf-app=""><span>content</span></div></div>'

afterEach(() => vi.unstubAllGlobals())

type UrlFetcherProps = {
  url: string
  loader?: never
  props: object
  errorFallback?: React.ReactElement | null
  degradeFallback?: React.ReactElement | null
  timeout?: number
}

type LoaderFetcherProps = {
  loader: () => Promise<ComponentType<object>>
  url?: never
  props: object
  errorFallback?: React.ReactElement | null
  degradeFallback?: React.ReactElement | null
  timeout?: number
}

type FetcherProps = UrlFetcherProps | LoaderFetcherProps

async function callFetcher(p: FetcherProps) {
  return (_MFBridgeSSRFetcher as unknown as (p: FetcherProps) => Promise<React.ReactElement | null>)(p)
}

// ─── url mode ────────────────────────────────────────────────────────────────

describe('MFBridgeSSRFetcher — url mode', () => {
  it('fetches fragment HTML and returns a host wrapper div', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(FRAG_HTML),
    }))

    const el = await callFetcher({ url: 'http://frag/', props: { n: 1 }, timeout: 1000 })
    expect(el).not.toBeNull()
    const html = renderToStaticMarkup(el!)
    expect(html).toContain('content')
    expect(html).toContain('data-mf-ssr')
    expect(html).toContain('data-mf-host')
  })

  it('encodes props as JSON in the fetch URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue(FRAG_HTML) })
    vi.stubGlobal('fetch', fetchMock)

    await callFetcher({ url: 'http://frag/', props: { key: 'val' }, timeout: 1000 })

    const calledUrl: string = fetchMock.mock.calls[0][0]
    expect(calledUrl).toContain('?props=')
    expect(JSON.parse(decodeURIComponent(calledUrl.split('props=')[1]))).toEqual({ key: 'val' })
  })

  it('prefers degradeFallback over errorFallback when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))

    const el = await callFetcher({
      url: 'http://frag/',
      props: {},
      degradeFallback: createElement('div', null, 'degraded'),
      errorFallback: createElement('div', null, 'error'),
      timeout: 1000,
    })

    expect(renderToStaticMarkup(el!)).toContain('degraded')
  })

  it('falls back to errorFallback when degradeFallback is absent and fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))

    const el = await callFetcher({
      url: 'http://frag/',
      props: {},
      errorFallback: createElement('span', null, 'error'),
      timeout: 1000,
    })

    expect(renderToStaticMarkup(el!)).toContain('error')
  })

  it('returns null when fetch fails and no fallbacks provided', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))

    const el = await callFetcher({ url: 'http://frag/', props: {}, timeout: 1000 })
    expect(el).toBeNull()
  })

  it('returns errorFallback when response status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: vi.fn() }))

    const el = await callFetcher({
      url: 'http://frag/',
      props: {},
      errorFallback: createElement('span', null, '503'),
      timeout: 1000,
    })

    expect(renderToStaticMarkup(el!)).toContain('503')
  })
})

// ─── loader mode ─────────────────────────────────────────────────────────────

describe('MFBridgeSSRFetcher — loader mode', () => {
  it('imports the component and renders it inline', async () => {
    function RemoteWidget({ label }: { label: string }) {
      return createElement('span', { 'data-testid': 'remote' }, label)
    }

    const el = await callFetcher({
      loader: () => Promise.resolve(RemoteWidget as ComponentType<object>),
      props: { label: 'hello from remote' },
      timeout: 1000,
    })

    expect(el).not.toBeNull()
    const html = renderToStaticMarkup(el!)
    expect(html).toContain('hello from remote')
    expect(html).toContain('data-testid="remote"')
  })

  it('forwards props to the loaded component', async () => {
    function Display({ a, b }: { a: number; b: string }) {
      return createElement('span', null, `${a}:${b}`)
    }

    const el = await callFetcher({
      loader: () => Promise.resolve(Display as unknown as ComponentType<object>),
      props: { a: 1, b: 'two' },
      timeout: 1000,
    })

    expect(el).not.toBeNull()
    expect(renderToStaticMarkup(el!)).toBe('<span>1:two</span>')
  })

  it('returns degradeFallback when loader rejects', async () => {
    const el = await callFetcher({
      loader: () => Promise.reject(new Error('load failed')),
      props: {},
      degradeFallback: createElement('div', null, 'degraded'),
      errorFallback: createElement('div', null, 'error'),
      timeout: 1000,
    })

    expect(renderToStaticMarkup(el!)).toContain('degraded')
  })

  it('returns errorFallback when loader rejects and no degradeFallback', async () => {
    const el = await callFetcher({
      loader: () => Promise.reject(new Error('load failed')),
      props: {},
      errorFallback: createElement('span', null, 'error-inline'),
      timeout: 1000,
    })

    expect(renderToStaticMarkup(el!)).toContain('error-inline')
  })

  it('returns null when loader rejects and no fallbacks provided', async () => {
    const el = await callFetcher({
      loader: () => Promise.reject(new Error('load failed')),
      props: {},
      timeout: 1000,
    })

    expect(el).toBeNull()
  })

  it('returns degradeFallback when loader exceeds timeout', async () => {
    const neverResolves = () => new Promise<ComponentType<object>>(() => {})

    const el = await callFetcher({
      loader: neverResolves,
      props: {},
      degradeFallback: createElement('div', null, 'timed-out'),
      timeout: 10, // 10 ms
    })

    expect(renderToStaticMarkup(el!)).toContain('timed-out')
  })
})
