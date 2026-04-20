import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { createMFReactFragment } from '../src/react-fragment.js'

function makeRequest(props?: unknown): Request {
  const url = new URL('/frag', 'http://localhost')
  if (props !== undefined) {
    url.searchParams.set('props', encodeURIComponent(JSON.stringify(props)))
  }
  return new Request(url.toString())
}

async function bodyText(res: Response): Promise<string> {
  return new Response(res.body).text()
}

describe('createMFReactFragment', () => {
  it('returns 200 with Content-Type text/html', async () => {
    function Widget() { return null }
    const handler = createMFReactFragment(Widget)
    const res = await handler(makeRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('renders the component and embeds serialized props', async () => {
    function Label({ text }: { text: string }) {
      return createElement('span', null, text)
    }
    const handler = createMFReactFragment(Label)
    const res = await handler(makeRequest({ text: 'hello' }))
    const html = await bodyText(res)
    expect(html).toContain('hello')
    expect(html).toContain('"text":"hello"')
    expect(html).toContain('data-mf-props')
  })

  it('wraps output in data-mf-ssr and data-mf-app containers', async () => {
    function Widget() { return null }
    const handler = createMFReactFragment(Widget)
    const res = await handler(makeRequest())
    const html = await bodyText(res)
    expect(html).toContain('data-mf-ssr')
    expect(html).toContain('data-mf-app')
  })

  it('uses component name as data-mf-ssr value', async () => {
    function CheckoutWidget() { return null }
    const handler = createMFReactFragment(CheckoutWidget)
    const res = await handler(makeRequest())
    const html = await bodyText(res)
    expect(html).toContain('data-mf-ssr="CheckoutWidget"')
  })

  it('uses explicit id over component name', async () => {
    function Widget() { return null }
    const handler = createMFReactFragment(Widget, { id: 'checkout' })
    const res = await handler(makeRequest())
    const html = await bodyText(res)
    expect(html).toContain('data-mf-ssr="checkout"')
  })

  it('handles missing props gracefully (defaults to empty object)', async () => {
    function Widget({ n = 42 }: { n?: number }) {
      return createElement('span', null, String(n))
    }
    const handler = createMFReactFragment(Widget)
    const res = await handler(makeRequest()) // no props param
    expect(res.status).toBe(200)
    const html = await bodyText(res)
    expect(html).toContain('42')
  })

  it('escapes < > & and </script> in embedded props JSON (XSS safety)', async () => {
    function Widget() { return null }
    const handler = createMFReactFragment(Widget)
    const res = await handler(makeRequest({
      a: '</script><script>alert(1)</script>',
      b: '<img src=x onerror=alert(1)>',
      c: 'a&b',
    }))
    const html = await bodyText(res)
    // No raw angle brackets or & in the embedded JSON
    const scriptBlock = html.match(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ''
    expect(scriptBlock).not.toMatch(/</)
    expect(scriptBlock).not.toMatch(/>/)
    expect(scriptBlock).not.toMatch(/&(?!amp;)/)
    // Escaped forms present
    expect(scriptBlock).toContain('\\u003c')
    expect(scriptBlock).toContain('\\u003e')
  })

  it('escapes U+2028 and U+2029 line terminators in embedded props JSON', async () => {
    function Widget() { return null }
    const handler = createMFReactFragment(Widget)
    const res = await handler(makeRequest({ text: 'a\u2028b\u2029c' }))
    const html = await bodyText(res)
    const scriptBlock = html.match(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? ''
    expect(scriptBlock).not.toContain('\u2028')
    expect(scriptBlock).not.toContain('\u2029')
    expect(scriptBlock).toContain('\\u2028')
    expect(scriptBlock).toContain('\\u2029')
  })
})
