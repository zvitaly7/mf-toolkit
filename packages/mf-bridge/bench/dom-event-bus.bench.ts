/**
 * @vitest-environment jsdom
 *
 * Throughput of DOMEventBus.send — the hot path for prop streaming from host
 * to remote. Every host re-render with new props calls bus.send('propsChanged')
 * which dispatches a CustomEvent to every listener on the mount-point element.
 */
import { bench, describe } from 'vitest'
import { DOMEventBus } from '../src/dom-event-bus.js'

function makeBus(listeners: number): DOMEventBus {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const bus = new DOMEventBus(el, 'bench')
  for (let i = 0; i < listeners; i++) {
    bus.on<{ n: number }>('propsChanged', () => { /* noop */ })
  }
  return bus
}

describe('DOMEventBus.send — 1 listener', () => {
  const bus = makeBus(1)
  bench('send propsChanged', () => { bus.send('propsChanged', { n: 1 }) })
})

describe('DOMEventBus.send — 10 listeners', () => {
  const bus = makeBus(10)
  bench('send propsChanged', () => { bus.send('propsChanged', { n: 1 }) })
})

describe('DOMEventBus.send — 100 listeners', () => {
  const bus = makeBus(100)
  bench('send propsChanged', () => { bus.send('propsChanged', { n: 1 }) })
})

describe('DOMEventBus.on — subscribe + unsubscribe', () => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const bus = new DOMEventBus(el, 'bench-sub')
  bench('on + unsub', () => {
    const unsub = bus.on('evt', () => {})
    unsub()
  })
})
