/**
 * Tests for defineMFEntry — framework-agnostic remote entry helper.
 *
 * Uses vanilla DOM manipulation to simulate what Vue / Angular / Svelte remotes
 * would do, verifying that all communication primitives (props, events, commands,
 * shadow DOM) work identically to the React createMFEntry counterpart.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineMFEntry } from '../src/define-entry.js'
import { DOMEventBus } from '../src/dom-event-bus.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMount(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

function cleanup(el: HTMLElement) {
  el.remove()
}

// ─── mount / unmount ─────────────────────────────────────────────────────────

describe('defineMFEntry — mount and unmount', () => {
  it('actually renders content into the DOM on mount', () => {
    const register = defineMFEntry<{ label: string }, HTMLSpanElement>({
      mount({ mountPointer, props }) {
        const span = document.createElement('span')
        span.textContent = props.label
        mountPointer.appendChild(span)
        return span
      },
      unmount(span, mp) { mp.removeChild(span) },
    })

    const el = makeMount()
    register({ mountPointer: el, props: { label: 'hello' }, namespace: 'test' })

    expect(el.textContent).toBe('hello')
    cleanup(el)
  })

  it('passes shadowRoot when provided and mount receives it', () => {
    let receivedRoot: ShadowRoot | undefined
    const register = defineMFEntry({
      mount({ mountPointer, shadowRoot }) {
        receivedRoot = shadowRoot
        if (shadowRoot) {
          const div = document.createElement('div')
          div.textContent = 'in shadow'
          shadowRoot.appendChild(div)
        }
        return null
      },
      unmount: () => {},
    })

    const el = makeMount()
    const shadow = el.attachShadow({ mode: 'open' })
    register({ mountPointer: el, shadowRoot: shadow, props: {}, namespace: 'test' })

    expect(receivedRoot).toBe(shadow)
    // Content is inside shadow root, not in the light DOM
    expect(el.shadowRoot?.textContent).toBe('in shadow')
    expect(el.textContent).toBe('')
    cleanup(el)
  })

  it('calls unmount with the instance returned by mount and removes DOM', () => {
    const register = defineMFEntry<object, HTMLDivElement>({
      mount({ mountPointer }) {
        const div = document.createElement('div')
        div.setAttribute('data-testid', 'widget')
        mountPointer.appendChild(div)
        return div
      },
      unmount(div, mp) { mp.removeChild(div) },
    })

    const el = makeMount()
    const teardown = register({ mountPointer: el, props: {}, namespace: 'test' })
    expect(el.querySelector('[data-testid="widget"]')).toBeTruthy()

    teardown()
    expect(el.querySelector('[data-testid="widget"]')).toBeNull()
    cleanup(el)
  })

  it('returns a no-op teardown when mount returns undefined implicitly', () => {
    const register = defineMFEntry({
      mount: () => undefined as unknown as null,
      unmount: () => {},
    })
    const el = makeMount()
    const teardown = register({ mountPointer: el, props: {}, namespace: 'test' })
    expect(() => teardown()).not.toThrow()
    cleanup(el)
  })
})

// ─── props update ─────────────────────────────────────────────────────────────

describe('defineMFEntry — props updates', () => {
  it('calls update when host sends propsChanged', () => {
    const instance = { node: document.createElement('span') }
    const update = vi.fn()
    const register = defineMFEntry({
      mount: ({ mountPointer, props }) => {
        instance.node.textContent = String((props as any).text)
        mountPointer.appendChild(instance.node)
        return instance
      },
      update,
      unmount: (inst, el) => el.removeChild(inst.node),
    })

    const el = makeMount()
    register({ mountPointer: el, props: { text: 'v1' }, namespace: 'test' })

    const bus = new DOMEventBus(el, 'test')
    bus.send('propsChanged', { text: 'v2' })

    expect(update).toHaveBeenCalledWith(instance, { text: 'v2' })
    cleanup(el)
  })

  it('does not throw when update is omitted and propsChanged fires', () => {
    const register = defineMFEntry({
      mount: () => null,
      // no update
      unmount: () => {},
    })

    const el = makeMount()
    register({ mountPointer: el, props: {}, namespace: 'test' })

    const bus = new DOMEventBus(el, 'test')
    expect(() => bus.send('propsChanged', { x: 1 })).not.toThrow()
    cleanup(el)
  })

  it('does not receive propsChanged after unmount', () => {
    const update = vi.fn()
    const register = defineMFEntry({ mount: () => null, update, unmount: () => {} })

    const el = makeMount()
    const teardown = register({ mountPointer: el, props: {}, namespace: 'test' })
    teardown()

    const bus = new DOMEventBus(el, 'test')
    bus.send('propsChanged', { x: 99 })

    expect(update).not.toHaveBeenCalled()
    cleanup(el)
  })
})

// ─── emit (remote → host) ─────────────────────────────────────────────────────

describe('defineMFEntry — emit', () => {
  it('emit sends an event the host can receive', () => {
    let capturedEmit!: (type: string, payload?: unknown) => void
    const register = defineMFEntry({
      mount: ({ emit }) => { capturedEmit = emit },
      unmount: () => {},
    })

    const el = makeMount()
    register({ mountPointer: el, props: {}, namespace: 'test' })

    const received: unknown[] = []
    const bus = new DOMEventBus(el, 'test')
    bus.on<{ type: string; payload: unknown }>('event', (d) => received.push(d))

    capturedEmit('orderPlaced', { id: 42 })

    expect(received).toEqual([{ type: 'orderPlaced', payload: { id: 42 } }])
    cleanup(el)
  })
})

// ─── onCommand (host → remote) ───────────────────────────────────────────────

describe('defineMFEntry — onCommand', () => {
  it('onCommand handler receives commands from the host', () => {
    const received: Array<{ type: string; payload: unknown }> = []
    const register = defineMFEntry({
      mount: ({ onCommand }) => {
        onCommand((type, payload) => received.push({ type, payload }))
      },
      unmount: () => {},
    })

    const el = makeMount()
    register({ mountPointer: el, props: {}, namespace: 'test' })

    const bus = new DOMEventBus(el, 'test')
    bus.send('command', { type: 'reset', payload: null })
    bus.send('command', { type: 'focus', payload: { field: 'email' } })

    expect(received).toEqual([
      { type: 'reset', payload: null },
      { type: 'focus', payload: { field: 'email' } },
    ])
    cleanup(el)
  })

  it('command subscriptions are cleaned up on unmount', () => {
    const received: string[] = []
    const register = defineMFEntry({
      mount: ({ onCommand }) => { onCommand((t) => received.push(t)) },
      unmount: () => {},
    })

    const el = makeMount()
    const teardown = register({ mountPointer: el, props: {}, namespace: 'test' })
    teardown()

    const bus = new DOMEventBus(el, 'test')
    bus.send('command', { type: 'ping', payload: undefined })

    expect(received).toHaveLength(0)
    cleanup(el)
  })
})

// ─── vanilla JS simulation ────────────────────────────────────────────────────

describe('defineMFEntry — vanilla JS simulation', () => {
  let mountPoint: HTMLElement

  beforeEach(() => { mountPoint = makeMount() })
  afterEach(() => cleanup(mountPoint))

  it('renders and updates a vanilla DOM widget', () => {
    const register = defineMFEntry<{ count: number }, HTMLSpanElement>({
      mount({ mountPointer, props }) {
        const span = document.createElement('span')
        span.setAttribute('data-testid', 'counter')
        span.textContent = String(props.count)
        mountPointer.appendChild(span)
        return span
      },
      update(span, props) {
        span.textContent = String(props.count)
      },
      unmount(span, mountPointer) {
        mountPointer.removeChild(span)
      },
    })

    register({ mountPointer: mountPoint, props: { count: 0 }, namespace: 'test' })
    expect(mountPoint.querySelector('[data-testid="counter"]')?.textContent).toBe('0')

    const bus = new DOMEventBus(mountPoint, 'test')
    bus.send('propsChanged', { count: 5 })
    expect(mountPoint.querySelector('[data-testid="counter"]')?.textContent).toBe('5')
  })

  it('removes DOM nodes on unmount', () => {
    const register = defineMFEntry<object, HTMLDivElement>({
      mount({ mountPointer }) {
        const div = document.createElement('div')
        div.setAttribute('data-testid', 'widget')
        mountPointer.appendChild(div)
        return div
      },
      unmount(div, mp) {
        mp.removeChild(div)
      },
    })

    const teardown = register({ mountPointer: mountPoint, props: {}, namespace: 'test' })
    expect(mountPoint.querySelector('[data-testid="widget"]')).toBeTruthy()

    teardown()
    expect(mountPoint.querySelector('[data-testid="widget"]')).toBeNull()
  })

  it('emits and receives commands inside a vanilla widget', () => {
    const events: string[] = []
    const commands: string[] = []

    const register = defineMFEntry<object, null>({
      mount({ emit, onCommand }) {
        emit('ready')
        onCommand((type) => commands.push(type))
        return null
      },
      unmount: () => {},
    })

    const bus = new DOMEventBus(mountPoint, 'test')
    bus.on<{ type: string; payload: unknown }>('event', ({ type }) => events.push(type))

    register({ mountPointer: mountPoint, props: {}, namespace: 'test' })
    bus.send('command', { type: 'ping', payload: undefined })

    expect(events).toEqual(['ready'])
    expect(commands).toEqual(['ping'])
  })
})
