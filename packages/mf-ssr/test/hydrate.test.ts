/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type ComponentType } from 'react'

vi.mock('react-dom/client', () => ({
  hydrateRoot: vi.fn(),
}))

import { hydrateRoot } from 'react-dom/client'
import { hydrateRemote } from '../src/hydrate.js'

function setupDOM(fragmentId: string, propsJson: string, contentHtml: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.setAttribute('data-mf-ssr', fragmentId)
  wrapper.innerHTML = `
    <script type="application/json" data-mf-props>${propsJson}</script>
    <div data-mf-app>${contentHtml}</div>
  `
  document.body.appendChild(wrapper)
  return wrapper
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('hydrateRemote', () => {
  it('hydrates data-mf-app with parsed props', () => {
    const wrapper = setupDOM('checkout', '{"cartId":42}', '<span>cart</span>')
    const Checkout: ComponentType<{ cartId: number }> = ({ cartId }) =>
      createElement('span', null, String(cartId))

    hydrateRemote(Checkout, { id: 'checkout' })

    expect(hydrateRoot).toHaveBeenCalledWith(
      wrapper.querySelector('[data-mf-app]'),
      createElement(Checkout, { cartId: 42 }),
    )
  })

  it('hydrates all matching fragments when no id is provided', () => {
    setupDOM('a', '{"n":1}', '')
    setupDOM('b', '{"n":2}', '')
    function W({ n }: { n: number }) { return createElement('span', null, String(n)) }

    hydrateRemote(W)

    expect(hydrateRoot).toHaveBeenCalledTimes(2)
  })

  it('targets by custom CSS selector', () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'my-widget'
    wrapper.innerHTML = `
      <script type="application/json" data-mf-props>{"x":7}</script>
      <div data-mf-app></div>
    `
    document.body.appendChild(wrapper)

    function W({ x }: { x: number }) { return createElement('span', null, String(x)) }
    hydrateRemote(W, { selector: '.my-widget' })

    expect(hydrateRoot).toHaveBeenCalledWith(
      wrapper.querySelector('[data-mf-app]'),
      createElement(W, { x: 7 }),
    )
  })

  it('skips a wrapper that has no data-mf-app child', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-mf-ssr', 'broken')
    wrapper.innerHTML = '<script type="application/json" data-mf-props>{"n":1}</script>'
    document.body.appendChild(wrapper)

    function W() { return null }
    hydrateRemote(W, { id: 'broken' })

    expect(hydrateRoot).not.toHaveBeenCalled()
  })

  it('defaults props to empty object when script JSON is invalid', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-mf-ssr', 'bad')
    wrapper.innerHTML = `
      <script type="application/json" data-mf-props>NOT_JSON</script>
      <div data-mf-app></div>
    `
    document.body.appendChild(wrapper)

    function W() { return null }
    hydrateRemote(W, { id: 'bad' })

    expect(hydrateRoot).toHaveBeenCalledWith(
      wrapper.querySelector('[data-mf-app]'),
      createElement(W, {}),
    )
  })

  it('does nothing when no matching wrappers exist', () => {
    function W() { return null }
    hydrateRemote(W, { id: 'nonexistent' })
    expect(hydrateRoot).not.toHaveBeenCalled()
  })
})
