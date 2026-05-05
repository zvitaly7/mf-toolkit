# `@mf-toolkit/mf-devtools`

[![license](https://img.shields.io/github/license/zvitaly7/mf-toolkit?color=blue)](https://github.com/zvitaly7/mf-toolkit/blob/main/LICENSE)
[![chrome](https://img.shields.io/badge/chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![react](https://img.shields.io/badge/react-18%20%7C%2019%20%7C%2020-61DAFB?logo=react)](https://react.dev)

![mf-devtools panel: instance grouping, props diff, bidirectional event log, filter chips, lifetime tracking](./assets/panel.png)

**Chrome DevTools panel that inspects [`@mf-toolkit/mf-bridge`](../mf-bridge) and [`@mf-toolkit/mf-ssr`](../mf-ssr) at runtime.**

Every microfrontend mount, prop update, host↔remote bus event, lazy-load attempt, retry, and SSR fragment fetch shows up in a dedicated DevTools tab — with full timeline, prop diffs, and a per-instance event log. Zero production cost: the emit sites in `mf-bridge` / `mf-ssr` are dead-code-eliminated in production builds.

> **This package is not published to npm.** It ships as a Chrome extension — load `dist/` unpacked for development, or install from the Chrome Web Store.

---

## The problem

You ship microfrontends with `mf-bridge` and `mf-ssr`. Once you have more than one on the page, runtime questions pile up fast:

- *Why did the cart fragment re-mount three times when I navigated?*
- *Are my props actually streaming to the remote, or is the host hoarding them?*
- *Did the lazy load retry, or is it stuck waiting for `import('checkout/entry')` that never resolves?*
- *Did the SSR fragment fetch fail silently, or did the host fall back to client render?*
- *Why is React's StrictMode dev cycle showing four instances when there's only one `<MFBridgeLazy>` in the JSX?*

Webpack stats and `console.log` don't answer these. React DevTools sees the host's tree, but doesn't model the bus channel between host and remote. Network panel shows fragment URLs but not which `<MFBridgeSSR>` triggered them.

## The solution

A purpose-built DevTools panel that subscribes to the same dev-only emitter that `mf-bridge` and `mf-ssr` already use, and renders it as a normalized model of every live (and recently unmounted) microfrontend instance.

```
┌─────────────────────────────┬──────────────────────────────────────┐
│  Instances (grouped by      │  Selected instance                   │
│  bus namespace)             │  ─────────────────                   │
│                             │  Info     mode, status, mount time…  │
│  • mfbridge-2 (auto)        │  Last props (snapshot)               │
│    ├─ LAZY      bridge-2    │  Event log                           │
│    └─ BRIDGE    bridge-4    │    +  0ms  mount   bridge mount …    │
│  • checkout                 │    + 32ms  load    load:start (1)    │
│    ├─ FETCH     ssr-3       │    + 84ms  load    load:ok (1)       │
│    └─ SSR-URL   ssr-5       │    +120ms  props   ~ items: [3]→[2]  │
│                             │    +250ms  event   ← host orderPlaced│
└─────────────────────────────┴──────────────────────────────────────┘
```

For every instance the panel captures:

- **Mode** — `lazy`, `bridge`, `hydrated`, `ssr-url`, `ssr-loader`, `fetch` (color-coded badges).
- **Status** — `loading`, `mounted`, `unmounted`, `error`.
- **Lifetime** — `alive 12s` while live, `was alive 1m 23s` after unmount.
- **Last props** + **diff between consecutive `props` updates** (`+ added`, `− removed`, `~ changed`).
- **Bidirectional event log** — `→ remote` for host commands, `← host` for remote notifications.
- **Lazy-load lifecycle** — `start` → `retry` → `ok` / `error`, with attempt counters.
- **SSR fetch lifecycle** — fragment HTTP fetches with attempts and error messages.

## Panel features

| Toolbar | What it does |
|---|---|
| **Clear** | Reset captured instances and event logs for the current tab. |
| **Pause / Resume** | Stop processing incoming events; events queue up and replay on resume. |
| **Export** | Download a JSON dump of all instances and their event logs (for bug reports). |
| **Hide unmounted** *(default on)* | Hide unmounted instances. Especially useful in dev — React StrictMode double-invokes effects, doubling the list with twin UNMOUNTED rows. |
| **Connection dot** | 🟢 connected · 🟡 reconnecting · 🔴 disconnected. MV3 service workers can be evicted after ~30s; the panel auto-reconnects and re-pulls buffered events. |
| **? (help)** | Cheat-sheet popover with the full mode + event-kind legend. |

| Detail pane | What it shows |
|---|---|
| Header | Namespace · mode badge · instance id · lifetime |
| **Info** | JSON snapshot — `pkg`, `mode`, `status`, `url`, `shadowDom`, `mountedAt`, `unmountedAt` |
| **Last props** | Most recent props the host streamed to the remote |
| **Event log** | All events on this instance, with per-kind filter chips and a count breakdown (`2 mount · 3 props · 1 event`). Each `props` row shows a diff against the previous snapshot |

### Grouped instances

A single `<MFBridgeLazy>` in JSX produces two records in the panel: the outer LAZY wrapper (load lifecycle) and the inner BRIDGE mount (props, events). They share a namespace and are rendered as parent → child:

```
mfbridge-2 (auto)
├── LAZY      bridge-2     ← outer wrapper, tracks load:start/retry/ok/error
└── BRIDGE    bridge-4     ← inner mount, tracks props + bus events
```

The same applies to StrictMode dev: each `mount → cleanup → mount` cycle produces a UNMOUNTED twin alongside the live row, all under one namespace group. Toggle **Hide unmounted** to filter them out.

### What does each badge mean?

The `?` button in the toolbar opens a cheat-sheet popover with the full legend — color of every mode badge, what every event `kind` means, why there can be a UNMOUNTED twin in dev, and why a single `<MFBridgeLazy>` produces two grouped records.

![Built-in help popover with mode legend, event-kind explanations, and FAQ on StrictMode UNMOUNTED twins](./assets/help.png)

## How it works

```
       page world                ISOLATED world             extension          devtools
┌──────────────────────┐       ┌────────────────┐       ┌──────────────┐    ┌──────────┐
│ window.              │ post  │ content-       │ chrome│  background  │port│  panel   │
│ __MF_DEVTOOLS_HOOK__ │ ─────►│   bridge.ts    │ ─────►│   (service   │───►│  (React) │
│  installed at        │Message│  buffers events│runtime│    worker)   │    │ reducer  │
│  document_start      │       │                │       │              │    │          │
└──────────────────────┘       └────────────────┘       └──────────────┘    └──────────┘
       ▲
       │ emitDev(event)        ◄── dead-code-eliminated in production builds
┌──────┴───────────────┐
│ @mf-toolkit/mf-bridge│
│ @mf-toolkit/mf-ssr   │
└──────────────────────┘
```

1. The extension's MAIN-world content script runs at `document_start` and installs `window.__MF_DEVTOOLS_HOOK__` **before** the user's bundle loads.
2. `mf-bridge` / `mf-ssr` call `emitDev(event)` at every relevant site — mount, unmount, propsChanged, event, command, load, fetch. The call is gated behind `process.env.NODE_ENV !== 'production'`, so the entire `_devtools.ts` module is dead-code-eliminated from production bundles.
3. The hook batches events with `queueMicrotask` and posts them to the ISOLATED-world content script via `window.postMessage`.
4. The content script forwards batches over `chrome.runtime.sendMessage` to the background service worker, which fans them to the open devtools panel via a long-lived `chrome.runtime.connect` port.
5. The panel's reducer normalises the event stream into instances + event logs, and renders them with React.

### MV3 robustness

Manifest V3 service workers can be evicted after ~30s of inactivity even with a long-lived port. The panel handles this transparently:

- `port.onDisconnect` triggers an auto-reconnect with a small backoff.
- After reconnect, the panel re-pulls whatever the content script has buffered while the worker was down.
- The reducer dedupes identical events (same `kind + ts + id`), so the replayed buffer doesn't double up the event log.

You can see the connection state in the toolbar — 🟢 connected / 🟡 reconnecting / 🔴 disconnected.

## Hook protocol

The page-world hook contract is versioned and JSON-serializable:

```ts
window.__MF_DEVTOOLS_HOOK__ = { v: 1, emit(event: MFEvent): void }
```

See [`src/shared/protocol.ts`](./src/shared/protocol.ts) for the full event union.

## Install (development)

From the repo root:

```bash
npm install
npm run build --workspace=@mf-toolkit/mf-devtools
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Pick `packages/mf-devtools/dist`.
5. Open DevTools on a page that uses `mf-bridge` / `mf-ssr` — the **MF DevTools** tab will appear.

For watch-mode while iterating on the panel UI:

```bash
npm run dev --workspace=@mf-toolkit/mf-devtools
```

After every edit, click **Reload** on the extension card in `chrome://extensions`, then close and reopen DevTools.

## FAQ

**Q: Why so many UNMOUNTED rows in dev?**
React StrictMode in development double-invokes every effect (`mount → cleanup → mount`) to surface bugs. Each pair shows up as a real instance + a UNMOUNTED twin. Toggle **Hide unmounted** in the toolbar to filter them out. Production builds don't have this.

**Q: Why `(auto)` next to a namespace like `mfbridge-2`?**
The host did not pass an explicit `namespace` prop, so the package generated `mfbridge-N` / `mfssr-N` for the bus channel. For multi-MF pages, prefer explicit names — they're stable across remounts and read better in DevTools.

**Q: Why does one `<MFBridgeLazy>` produce two rows?**
The outer LAZY wrapper tracks the load lifecycle (`start`, `retry`, `ok`, `error`). Once the remote loads, an inner BRIDGE is rendered to do the actual mount and props/events. They share a namespace and are grouped together in the panel.

**Q: I see "Failed to fetch" but no `load:retry` / `load:error`.**
Webpack Module Federation does **not** reject `import('remote/entry')` when the remote server is unreachable — the promise just hangs. To get `load:retry` / `load:error`, pass an explicit `timeout` prop to `<MFBridgeLazy>`.

**Q: A `props` row says "re-emitted (reference change, no value diff)". What's wrong?**
The host re-rendered and passed a new props object/callback to the bridge — `mf-bridge` emitted `propsChanged` because the *reference* changed, but every key is structurally equal to the previous snapshot. Usually means the host is creating fresh inline callbacks every render. Wrap them in `useCallback` (or memoize the Context value) to remove the churn.

**Q: Production cost?**
Zero. The `emitDev` call sites are guarded by `if (process.env.NODE_ENV !== 'production')` and the entire `_devtools.ts` module is dead-code-eliminated by webpack/vite/esbuild in production builds.
