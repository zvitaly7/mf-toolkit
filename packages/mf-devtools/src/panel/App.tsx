import { useEffect, useMemo, useReducer, useState } from 'react'
import { initialModel, reduce, reduceMany, clearModel, type Instance, type Model } from './state.js'
import type { MFEvent, RuntimeMessage } from '../shared/protocol.js'

type Action =
  | { type: 'events'; events: MFEvent[] }
  | { type: 'clear' }

function modelReducer(state: Model, action: Action): Model {
  switch (action.type) {
    case 'events':
      return reduceMany(state, action.events)
    case 'clear':
      return clearModel()
  }
}

export function App(): React.JSX.Element {
  const [model, dispatch] = useReducer(modelReducer, initialModel)
  const [selected, setSelected] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const pausedRef = useBufferedPause(paused, dispatch)

  // Wire up the long-lived port to the background service worker once per panel.
  useEffect(() => {
    const tabId = chrome.devtools.inspectedWindow.tabId
    const port = chrome.runtime.connect({ name: `mf-devtools:${tabId}` })

    const onMessage = (msg: RuntimeMessage): void => {
      if (msg.type !== 'mf-events') return
      if (pausedRef.current) {
        pausedRef.buffer.push(...msg.events)
        return
      }
      dispatch({ type: 'events', events: msg.events })
    }
    port.onMessage.addListener(onMessage)

    // Pull whatever the content script buffered before we connected.
    void chrome.tabs.sendMessage<RuntimeMessage, { events?: MFEvent[] }>(
      tabId,
      { type: 'mf-panel-ready', tabId },
    ).then((res) => {
      if (res?.events?.length) dispatch({ type: 'events', events: res.events })
    }).catch(() => {
      // No content script on this tab (chrome:// page, no permissions, etc.).
    })

    return () => {
      port.onMessage.removeListener(onMessage)
      port.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const items = useMemo(() => model.order.map((id) => model.byId[id]).filter(Boolean), [model])
  const selectedInstance = selected ? model.byId[selected] : null

  return (
    <div className="layout">
      <div className="toolbar">
        <button
          onClick={() => {
            dispatch({ type: 'clear' })
            setSelected(null)
            const tabId = chrome.devtools.inspectedWindow.tabId
            void chrome.tabs.sendMessage(tabId, { type: 'mf-clear', tabId }).catch(() => {})
          }}
        >
          Clear
        </button>
        <button onClick={() => setPaused((p) => !p)}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <span className="status">
          {items.length} {items.length === 1 ? 'instance' : 'instances'}
        </span>
      </div>

      <div className="list">
        {items.length === 0 ? (
          <div className="empty">
            No microfrontends detected yet.
            <br />
            Mount an MFBridge / MFBridgeSSR component on the page.
          </div>
        ) : (
          items.map((inst) => (
            <ListRow
              key={inst.id}
              inst={inst}
              selected={inst.id === selected}
              onSelect={() => setSelected(inst.id)}
            />
          ))
        )}
      </div>

      <div className="detail">
        {selectedInstance ? (
          <Detail inst={selectedInstance} />
        ) : (
          <div className="empty-detail">Select an instance to inspect.</div>
        )}
      </div>
    </div>
  )
}

interface ListRowProps {
  inst: Instance
  selected: boolean
  onSelect: () => void
}

function ListRow({ inst, selected, onSelect }: ListRowProps): React.JSX.Element {
  return (
    <div className={`list-item${selected ? ' selected' : ''}`} onClick={onSelect}>
      <div className="ns">{inst.namespace || '(no namespace)'}</div>
      <div className="meta">
        <span className={`badge badge-${inst.mode === 'fetch' ? 'ssr-url' : inst.mode}`}>
          {inst.mode}
        </span>
        {inst.status === 'unmounted' && <span className="badge badge-unmounted">unmounted</span>}
        {inst.status === 'error' && <span className="badge badge-error">error</span>}
        {inst.shadowDom && <span className="badge badge-bridge">shadow</span>}
        <span title={inst.id}>{inst.id}</span>
      </div>
      {inst.url && (
        <div className="meta" title={inst.url}>
          {truncate(inst.url, 40)}
        </div>
      )}
    </div>
  )
}

function Detail({ inst }: { inst: Instance }): React.JSX.Element {
  return (
    <>
      <h2>{inst.namespace || '(no namespace)'} <small style={{ color: '#888', fontWeight: 400 }}>· {inst.id}</small></h2>
      <h3>Info</h3>
      <pre>{JSON.stringify({
        pkg: inst.pkg,
        mode: inst.mode,
        status: inst.status,
        url: inst.url,
        shadowDom: inst.shadowDom,
        mountedAt: new Date(inst.mountedAt).toISOString(),
        unmountedAt: inst.unmountedAt ? new Date(inst.unmountedAt).toISOString() : undefined,
      }, null, 2)}</pre>
      {inst.lastProps !== undefined && (
        <>
          <h3>Last props</h3>
          <pre>{safeStringify(inst.lastProps)}</pre>
        </>
      )}
      <h3>Event log ({inst.events.length})</h3>
      <div>
        {inst.events.map((e, i) => (
          <EventRow key={i} ev={e} t0={inst.mountedAt} />
        ))}
      </div>
    </>
  )
}

function EventRow({ ev, t0 }: { ev: MFEvent; t0: number }): React.JSX.Element {
  const dt = `+${(ev.ts - t0).toString().padStart(4, ' ')}ms`
  let summary: React.ReactNode
  let cls = ''
  switch (ev.kind) {
    case 'mount':
      summary = <span>{ev.mode} mount {ev.namespace ? `[${ev.namespace}]` : ''}</span>
      break
    case 'unmount':
      summary = <span>unmount</span>
      break
    case 'props':
      summary = <code>{summarizeProps(ev.props)}</code>
      break
    case 'event': {
      const out = ev.direction === 'host->remote'
      cls = out ? 'arrow-out' : 'arrow-in'
      summary = (
        <span>
          {out ? '→ remote' : '← host'} <strong>{ev.type}</strong>{' '}
          {ev.payload !== undefined && <code>{summarizeProps(ev.payload)}</code>}
        </span>
      )
      break
    }
    case 'load':
      summary = (
        <span className={ev.phase === 'error' ? 'err' : ''}>
          load:{ev.phase}
          {ev.attempt !== undefined ? ` (attempt ${ev.attempt})` : ''}
          {ev.error ? ` — ${ev.error}` : ''}
        </span>
      )
      break
    case 'fetch':
      summary = (
        <span className={ev.phase === 'error' ? 'err' : ''}>
          fetch:{ev.phase}
          {ev.attempt !== undefined ? ` #${ev.attempt}` : ''}
          {ev.error ? ` — ${ev.error}` : ''}
        </span>
      )
      break
  }
  return (
    <div className="event-row">
      <span className="ts">{dt}</span>
      <span className="kind">{ev.kind}</span>
      <span></span>
      <span className={cls}>{summary}</span>
    </div>
  )
}

function summarizeProps(p: unknown): string {
  const s = safeStringify(p)
  return s.length > 80 ? s.slice(0, 77) + '…' : s
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

/**
 * While paused, buffer incoming events and drain them on resume so the panel
 * doesn't drop activity that happens during inspection.
 */
function useBufferedPause(
  paused: boolean,
  dispatch: React.Dispatch<Action>,
): { current: boolean; buffer: MFEvent[] } {
  const ref = useMemo(() => ({ current: paused, buffer: [] as MFEvent[] }), [])
  ref.current = paused
  useEffect(() => {
    if (!paused && ref.buffer.length > 0) {
      const flushed = ref.buffer
      ref.buffer = []
      dispatch({ type: 'events', events: flushed })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])
  return ref
}

// Re-export reducer for any future test harness.
export { reduce }
