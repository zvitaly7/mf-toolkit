/**
 * Reduces a stream of MFEvents into a normalized model the UI can render:
 * one entry per mounted (or recently-unmounted) instance, plus an event log.
 *
 * Fetch events without a paired mount (Suspense fetch happens before the
 * ssr-url mount commits) get their own synthetic instance keyed by fetch id,
 * so they show up in the list as a "Fetch" row until the mount catches up.
 */

import type { MFEvent, MFMode } from '../shared/protocol.js'

export interface Instance {
  id: string
  pkg: 'bridge' | 'ssr' | 'fetch'
  namespace: string
  mode: MFMode | 'fetch'
  status: 'loading' | 'mounted' | 'unmounted' | 'error'
  url?: string
  shadowDom?: boolean
  lastProps?: unknown
  mountedAt: number
  unmountedAt?: number
  events: MFEvent[]
}

export interface Model {
  /** Insertion order preserved via Array. Map keyed by id. */
  byId: Record<string, Instance>
  order: string[]
  /** Cap to keep memory bounded for very chatty pages. */
}

const MAX_EVENTS_PER_INSTANCE = 500

export const initialModel: Model = { byId: {}, order: [] }

function ensureInstance(model: Model, id: string, seed: Partial<Instance>): Instance {
  const existing = model.byId[id]
  if (existing) return existing
  const now = Date.now()
  const inst: Instance = {
    id,
    pkg: seed.pkg ?? 'bridge',
    namespace: seed.namespace ?? '',
    mode: seed.mode ?? 'bridge',
    status: seed.status ?? 'loading',
    url: seed.url,
    shadowDom: seed.shadowDom,
    lastProps: seed.lastProps,
    mountedAt: seed.mountedAt ?? now,
    events: [],
  }
  model.byId[id] = inst
  model.order.push(id)
  return inst
}

function appendEvent(inst: Instance, event: MFEvent): void {
  inst.events.push(event)
  if (inst.events.length > MAX_EVENTS_PER_INSTANCE) {
    inst.events.splice(0, inst.events.length - MAX_EVENTS_PER_INSTANCE)
  }
}

/** Apply a single event to the model. Returns a new shallow copy. */
export function reduce(model: Model, event: MFEvent): Model {
  const next: Model = { byId: { ...model.byId }, order: model.order.slice() }

  switch (event.kind) {
    case 'mount': {
      const inst = ensureInstance(next, event.id, {
        pkg: event.pkg,
        namespace: event.namespace,
        mode: event.mode,
        url: event.url,
        shadowDom: event.shadowDom,
        lastProps: event.props,
        mountedAt: event.ts,
        status: 'mounted',
      })
      // If we created via ensureInstance with seed values that's fine; if it
      // already existed (e.g. a load:start before mount), update fields.
      inst.pkg = event.pkg
      inst.namespace = event.namespace
      inst.mode = event.mode
      inst.url = event.url
      inst.shadowDom = event.shadowDom
      inst.lastProps = event.props
      inst.mountedAt = event.ts
      inst.status = 'mounted'
      appendEvent(inst, event)
      break
    }
    case 'unmount': {
      const inst = next.byId[event.id]
      if (inst) {
        inst.status = 'unmounted'
        inst.unmountedAt = event.ts
        appendEvent(inst, event)
      }
      break
    }
    case 'props': {
      const inst = next.byId[event.id]
      if (inst) {
        inst.lastProps = event.props
        appendEvent(inst, event)
      }
      break
    }
    case 'event': {
      const inst = next.byId[event.id]
      if (inst) appendEvent(inst, event)
      break
    }
    case 'load': {
      const inst = ensureInstance(next, event.id, {
        pkg: 'bridge',
        namespace: '',
        mode: 'lazy',
        status: event.phase === 'error' ? 'error' : 'loading',
        mountedAt: event.ts,
      })
      if (event.phase === 'error') inst.status = 'error'
      else if (event.phase === 'ok') inst.status = 'mounted'
      appendEvent(inst, event)
      break
    }
    case 'fetch': {
      const inst = ensureInstance(next, event.id, {
        pkg: 'fetch',
        namespace: '',
        mode: 'fetch',
        status: event.phase === 'error' ? 'error' : 'loading',
        url: event.url,
        mountedAt: event.ts,
      })
      if (event.phase === 'error') inst.status = 'error'
      else if (event.phase === 'ok') inst.status = 'mounted'
      appendEvent(inst, event)
      break
    }
  }

  return next
}

export function reduceMany(model: Model, events: MFEvent[]): Model {
  let m = model
  for (const e of events) m = reduce(m, e)
  return m
}

export function clearModel(): Model {
  return { byId: {}, order: [] }
}
