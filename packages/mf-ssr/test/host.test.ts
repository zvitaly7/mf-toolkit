import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { _MFBridgeSSRFetcher } from '../src/host.js'

const FRAG_HTML = '<div data-mf-ssr="W"><script type="application/json" data-mf-props="">{"n":1}</script><div data-mf-app=""><span>content</span></div></div>'

afterEach(() => vi.unstubAllGlobals())

type FetcherProps = {
  url: string
  props: object
  errorFallback?: React.ReactElement | null
  degradeFallback?: React.ReactElement | null
  timeout?: number
}

async function callFetcher(p: FetcherProps) {
  return (_MFBridgeSSRFetcher as unknown as (p: FetcherProps) => Promise<React.ReactElement | null>)(p)
}

describe('MFBridgeSSRFetcher', () => {
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
