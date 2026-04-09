import { describe, it, expect, vi } from 'vitest'
import { DOMEventBus } from '../src/dom-event-bus.js'

function makeEl(): HTMLElement {
  return document.createElement('div')
}

describe('DOMEventBus', () => {
  it('delivers event detail to a registered listener', () => {
    const el = makeEl()
    const bus = new DOMEventBus(el, 'test')
    const handler = vi.fn()

    bus.on('update', handler)
    bus.send('update', { value: 42 })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith({ value: 42 })
  })

  it('does not deliver after unsubscribe', () => {
    const el = makeEl()
    const bus = new DOMEventBus(el, 'test')
    const handler = vi.fn()

    const off = bus.on('update', handler)
    off()
    bus.send('update', { value: 1 })

    expect(handler).not.toHaveBeenCalled()
  })

  it('isolates events by namespace', () => {
    const el = makeEl()
    const busA = new DOMEventBus(el, 'ns-a')
    const busB = new DOMEventBus(el, 'ns-b')
    const handlerA = vi.fn()
    const handlerB = vi.fn()

    busA.on('ping', handlerA)
    busB.on('ping', handlerB)

    busA.send('ping', 'hello')

    expect(handlerA).toHaveBeenCalledWith('hello')
    expect(handlerB).not.toHaveBeenCalled()
  })

  it('supports multiple listeners on the same event', () => {
    const el = makeEl()
    const bus = new DOMEventBus(el, 'test')
    const h1 = vi.fn()
    const h2 = vi.fn()

    bus.on('tick', h1)
    bus.on('tick', h2)
    bus.send('tick', 'x')

    expect(h1).toHaveBeenCalledWith('x')
    expect(h2).toHaveBeenCalledWith('x')
  })

  it('does not bubble events', () => {
    const parent = document.createElement('div')
    const child = document.createElement('div')
    parent.appendChild(child)
    document.body.appendChild(parent)

    const bus = new DOMEventBus(child, 'test')
    const parentHandler = vi.fn()
    parent.addEventListener('test:update', parentHandler)

    bus.send('update', 1)
    expect(parentHandler).not.toHaveBeenCalled()

    parent.removeEventListener('test:update', parentHandler)
    document.body.removeChild(parent)
  })
})
