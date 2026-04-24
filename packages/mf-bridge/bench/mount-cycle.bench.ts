/**
 * @vitest-environment jsdom
 *
 * Mount / unmount cycle for MFBridge. Measures how fast a host can spin a
 * remote component up and down — the hot path for route changes that swap
 * MF slots.
 */
import { bench, describe } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from '@testing-library/react'
import { MFBridge } from '../src/host.js'
import { createMFEntry } from '../src/entry.js'

function Widget({ n }: { n: number }) {
  return createElement('span', null, String(n))
}

const register = createMFEntry(Widget)

function mountBridge() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(createElement(MFBridge, { register, props: { n: 1 } }))
  })
  return { root, host }
}

describe('MFBridge — mount + unmount', () => {
  bench('full cycle', () => {
    const { root, host } = mountBridge()
    act(() => root.unmount())
    host.remove()
  })
})

describe('MFBridge — props update', () => {
  const { root } = mountBridge()
  let n = 0
  bench('setProps', () => {
    n++
    act(() => {
      root.render(createElement(MFBridge, { register, props: { n } }))
    })
  })
})
