/**
 * Tests that the remote-side entry points emit dev-only devtools events the
 * mf-devtools panel consumes. The host half (MFBridge/MFBridgeLazy/MFBridgeSSR)
 * was already instrumented; these cover the previously-silent remote half:
 *   createMFEntry      → mode 'remote-entry'
 *   defineMFEntry      → mode 'remote-define-entry'
 *   hydrateWithBridge  → mode 'remote-hydrate'
 *
 * Each mount/props/unmount triple must share one id so the reducer can
 * correlate them, and remote ids must not collide with the host's `bridge-N`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { createElement } from 'react'
import { createMFEntry } from '../src/entry.js'
import { defineMFEntry } from '../src/define-entry.js'
import { hydrateWithBridge } from '../src/hydrate.js'
import { DOMEventBus } from '../src/dom-event-bus.js'
import type { MFDevtoolsEvent } from '../src/_devtools.js'

function Label({ text }: { text: string }) {
  return createElement('span', { 'data-testid': 'label' }, text)
}

let emit: ReturnType<typeof vi.fn>
const events = (): MFDevtoolsEvent[] => emit.mock.calls.map((c) => c[0] as MFDevtoolsEvent)

beforeEach(() => {
  emit = vi.fn()
  ;(globalThis as { __MF_DEVTOOLS_HOOK__?: unknown }).__MF_DEVTOOLS_HOOK__ = { v: 1, emit }
})

afterEach(() => {
  delete (globalThis as { __MF_DEVTOOLS_HOOK__?: unknown }).__MF_DEVTOOLS_HOOK__
  cleanup()
})

describe('createMFEntry devtools instrumentation', () => {
  it('emits remote-entry mount/props/unmount sharing one id', async () => {
    const mountPoint = document.createElement('div')
    document.body.appendChild(mountPoint)
    const register = createMFEntry(Label)

    let unmount!: () => void
    await act(async () => {
      unmount = register({ mountPointer: mountPoint, props: { text: 'hi' }, namespace: 'cart' })
    })

    const mountEv = events().find((e) => e.kind === 'mount')
    expect(mountEv).toMatchObject({
      kind: 'mount',
      pkg: 'bridge',
      mode: 'remote-entry',
      namespace: 'cart',
    })
    const id = mountEv!.id
    expect(id.startsWith('bridge-')).toBe(false) // must not collide with host ids

    await act(async () => {
      new DOMEventBus(mountPoint, 'cart').send('propsChanged', { text: 'bye' })
    })
    const propsEv = events().find((e) => e.kind === 'props')
    expect(propsEv?.id).toBe(id)

    await act(async () => { unmount() })
    expect(events().find((e) => e.kind === 'unmount')?.id).toBe(id)

    mountPoint.remove()
  })
})

describe('defineMFEntry devtools instrumentation', () => {
  it('emits remote-define-entry mount/props/unmount sharing one id', async () => {
    const mountPoint = document.createElement('div')
    document.body.appendChild(mountPoint)

    const register = defineMFEntry<{ text: string }, HTMLElement>({
      mount({ mountPointer, props }) {
        const el = document.createElement('span')
        el.textContent = props.text
        mountPointer.appendChild(el)
        return el
      },
      update(el, props) { el.textContent = props.text },
      unmount(el, mp) { mp.removeChild(el) },
    })

    let unmount!: () => void
    await act(async () => {
      unmount = register({ mountPointer: mountPoint, props: { text: 'hi' }, namespace: 'vue-app' })
    })

    const mountEv = events().find((e) => e.kind === 'mount')
    expect(mountEv).toMatchObject({
      kind: 'mount',
      pkg: 'bridge',
      mode: 'remote-define-entry',
      namespace: 'vue-app',
    })
    const id = mountEv!.id

    await act(async () => {
      new DOMEventBus(mountPoint, 'vue-app').send('propsChanged', { text: 'bye' })
    })
    expect(events().find((e) => e.kind === 'props')?.id).toBe(id)

    await act(async () => { unmount() })
    expect(events().find((e) => e.kind === 'unmount')?.id).toBe(id)

    mountPoint.remove()
  })
})

describe('hydrateWithBridge devtools instrumentation', () => {
  it('emits remote-hydrate mount/props/unmount sharing one id', async () => {
    const host = document.createElement('div')
    host.setAttribute('data-mf-namespace', 'checkout')
    const app = document.createElement('div')
    app.setAttribute('data-mf-app', '')
    app.innerHTML = '<span data-testid="label">42</span>'
    host.appendChild(app)
    document.body.appendChild(host)

    let teardown!: () => void
    await act(async () => {
      teardown = hydrateWithBridge(Label as never, { namespace: 'checkout' })
    })

    const mountEv = events().find((e) => e.kind === 'mount')
    expect(mountEv).toMatchObject({
      kind: 'mount',
      pkg: 'bridge',
      mode: 'remote-hydrate',
      namespace: 'checkout',
    })
    const id = mountEv!.id

    await act(async () => {
      new DOMEventBus(host, 'checkout').send('propsChanged', { text: '99' })
    })
    expect(events().find((e) => e.kind === 'props')?.id).toBe(id)

    await act(async () => { teardown() })
    expect(events().find((e) => e.kind === 'unmount')?.id).toBe(id)

    host.remove()
  })
})
