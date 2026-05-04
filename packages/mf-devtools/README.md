# @mf-toolkit/mf-devtools

Chrome DevTools extension that inspects [`@mf-toolkit/mf-bridge`](../mf-bridge) and [`@mf-toolkit/mf-ssr`](../mf-ssr) at runtime.

> **This package is not published to npm.** It is a developer companion shipped via the Chrome Web Store (or loaded unpacked from `dist/` for development).

## What it shows

- **List of mounted instances** — namespace, mode (`bridge` / `lazy` / `hydrated` / `ssr-url` / `ssr-loader`), status, fragment URL.
- **Last props snapshot** for every instance.
- **Bidirectional event log** — host→remote commands, remote→host events, with timestamps relative to mount.
- **Lazy-load lifecycle** — `start` / `retry` / `ok` / `error` events with attempt counts.
- **SSR fetch lifecycle** — fragment URL fetches with attempts and error messages.

## How it works

1. A content script runs in the page's MAIN world at `document_start` and installs `window.__MF_DEVTOOLS_HOOK__` before the user's bundle loads.
2. `mf-bridge` and `mf-ssr` call `emitDev(event)` at every mount, unmount, propsChanged, event/command, load and fetch site. The call is gated behind `process.env.NODE_ENV !== 'production'`, so it is dead-code-eliminated from production bundles.
3. A second content script in the ISOLATED world receives events via `window.postMessage` and forwards them to the service worker, which fans them to the open devtools panel.

## Develop

```bash
npm install
npm run build --workspace=@mf-toolkit/mf-devtools
```

Then in Chrome: `chrome://extensions` → "Load unpacked" → pick `packages/mf-devtools/dist`.

For watch mode while iterating on the panel UI:

```bash
npm run dev --workspace=@mf-toolkit/mf-devtools
```

## Hook protocol

The page-world hook contract (versioned, JSON-serializable):

```ts
window.__MF_DEVTOOLS_HOOK__ = { v: 1, emit(event) { ... } }
```

See `src/shared/protocol.ts` for the full event union.
