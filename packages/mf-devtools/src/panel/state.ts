/**
 * Reduces a stream of MFEvents into a normalized model the UI can render:
 * one entry per mounted (or recently-unmounted) instance, plus an event log.
 *
 * Fetch events without a paired mount (Suspense fetch happens before the
 * ssr-url mount commits) get their own synthetic instance keyed by fetch id,
 * so they show up in the list as a "Fetch" row until the mount catches up.
 *
 * The reducer is fully immutable: every event produces a new Model, a new
 * `byId` map (only the affected instance replaced), and a new `events` array
 * on that instance. This is what lets the panel's React.useMemo deps catch
 * updates — mutating arrays in place silently breaks dependency tracking.
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

/**
 * Append an event to an instance's event log immutably. Returns a NEW
 * `events` array (or the same one if the event was deduplicated as a
 * replay). Dedupe key: same `kind + ts` within the last ~32 events. We
 * may receive identical events twice if the panel reconnects after the
 * service worker dies — content-bridge replays its buffer and some of
 * those entries were already delivered through the live port.
 */
function appendEvent(events: MFEvent[], event: MFEvent): MFEvent[] {
  for (let i = events.length - 1; i >= 0 && i >= events.length - 32; i--) {
    const e = events[i]
    if (e.kind === event.kind && e.ts === event.ts) return events
  }
  const next = events.length >= MAX_EVENTS_PER_INSTANCE
    ? events.slice(events.length - MAX_EVENTS_PER_INSTANCE + 1)
    : events.slice()
  next.push(event)
  return next
}

interface InstanceSeed {
  pkg: Instance['pkg']
  namespace: string
  mode: Instance['mode']
  status: Instance['status']
  mountedAt: number
  url?: string
  shadowDom?: boolean
  lastProps?: unknown
}

function createInstance(id: string, seed: InstanceSeed): Instance {
  return {
    id,
    pkg: seed.pkg,
    namespace: seed.namespace,
    mode: seed.mode,
    status: seed.status,
    url: seed.url,
    shadowDom: seed.shadowDom,
    lastProps: seed.lastProps,
    mountedAt: seed.mountedAt,
    events: [],
  }
}

/** Apply a single event to the model. Returns a new shallow copy. */
export function reduce(model: Model, event: MFEvent): Model {
  switch (event.kind) {
    case 'mount': {
      const existing = model.byId[event.id]
      const base = existing ?? createInstance(event.id, {
        pkg: event.pkg,
        namespace: event.namespace,
        mode: event.mode,
        status: 'mounted',
        mountedAt: event.ts,
        url: event.url,
        shadowDom: event.shadowDom,
        lastProps: event.props,
      })
      const updated: Instance = {
        ...base,
        pkg: event.pkg,
        namespace: event.namespace,
        mode: event.mode,
        url: event.url,
        shadowDom: event.shadowDom,
        lastProps: event.props,
        mountedAt: event.ts,
        unmountedAt: undefined,
        status: 'mounted',
        events: appendEvent(base.events, event),
      }
      return upsert(model, event.id, updated, !existing)
    }

    case 'unmount': {
      const existing = model.byId[event.id]
      if (!existing) return model
      const updated: Instance = {
        ...existing,
        status: 'unmounted',
        unmountedAt: event.ts,
        events: appendEvent(existing.events, event),
      }
      return upsert(model, event.id, updated, false)
    }

    case 'props': {
      const existing = model.byId[event.id]
      if (!existing) return model
      const updated: Instance = {
        ...existing,
        lastProps: event.props,
        events: appendEvent(existing.events, event),
      }
      return upsert(model, event.id, updated, false)
    }

    case 'event': {
      const existing = model.byId[event.id]
      if (!existing) return model
      const updated: Instance = {
        ...existing,
        events: appendEvent(existing.events, event),
      }
      return upsert(model, event.id, updated, false)
    }

    case 'load': {
      const existing = model.byId[event.id]
      const status: Instance['status'] =
        event.phase === 'error' ? 'error' : event.phase === 'ok' ? 'mounted' : 'loading'
      const base = existing ?? createInstance(event.id, {
        pkg: 'bridge',
        namespace: '',
        mode: 'lazy',
        status,
        mountedAt: event.ts,
      })
      const updated: Instance = {
        ...base,
        status: existing?.status === 'mounted' && event.phase !== 'error' ? base.status : status,
        events: appendEvent(base.events, event),
      }
      return upsert(model, event.id, updated, !existing)
    }

    case 'fetch': {
      const existing = model.byId[event.id]
      const status: Instance['status'] =
        event.phase === 'error' ? 'error' : event.phase === 'ok' ? 'mounted' : 'loading'
      const base = existing ?? createInstance(event.id, {
        pkg: 'fetch',
        namespace: '',
        mode: 'fetch',
        status,
        url: event.url,
        mountedAt: event.ts,
      })
      const updated: Instance = {
        ...base,
        status: existing?.status === 'mounted' && event.phase !== 'error' ? base.status : status,
        events: appendEvent(base.events, event),
      }
      return upsert(model, event.id, updated, !existing)
    }

    case 'federation':
      // Federation snapshots are panel-level (App state's `hints`), not
      // bound to any individual instance. Ignore them in the model reducer.
      return model
  }
}

/**
 * Replace one instance in the model immutably. Both `byId` and (when adding
 * a new instance) `order` are returned as new arrays/objects.
 */
function upsert(model: Model, id: string, inst: Instance, isNew: boolean): Model {
  return {
    byId: { ...model.byId, [id]: inst },
    order: isNew ? [...model.order, id] : model.order,
  }
}

export function reduceMany(model: Model, events: MFEvent[]): Model {
  let m = model
  for (const e of events) m = reduce(m, e)
  return m
}

export function clearModel(): Model {
  return { byId: {}, order: [] }
}
