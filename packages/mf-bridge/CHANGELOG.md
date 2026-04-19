# Changelog

All notable changes to `@mf-toolkit/mf-bridge` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.0] — 2026-04-19

### Added

- **`MFBridgeHydrated`** — host-side client component for SSR + prop streaming.
  After a fragment is server-rendered by `@mf-toolkit/mf-ssr`'s `MFBridgeSSR`,
  `MFBridgeHydrated` takes over on the client: it finds the
  `[data-mf-namespace]` container and streams prop updates to the already-hydrated
  remote component via `DOMEventBus`. Supports `onEvent`, `commandRef`, and `debug`.
  Available from the main export.

- **`hydrateWithBridge`** — remote client-bundle counterpart to `MFBridgeHydrated`.
  Export path: `@mf-toolkit/mf-bridge/hydrate`.
  Locates the `[data-mf-namespace]` container, calls `React.hydrateRoot` on
  `[data-mf-app]`, and subscribes to `propsChanged` events — calling
  `root.render()` on every update from the host. Also forwards `command` events
  to an optional `onCommand` handler.

- **`./hydrate` package export** — tree-shakeable entry point for the remote
  client bundle. Importing from `@mf-toolkit/mf-bridge/hydrate` pulls in
  `react-dom/client` but none of the host-side code.

---

## [0.2.0] — 2026-04-10

### Added

- **`onEvent` / `emit`** — remote→host custom events without shared module state.  
  The remote calls `emit(type, payload)` inside `onBeforeMount`; the host
  receives it via the `onEvent` prop on `MFBridge` / `MFBridgeLazy`.

- **`commandRef` / `onCommand`** — host→remote imperative commands.  
  The host passes a `commandRef` to `MFBridge`; after mount `commandRef.current`
  becomes a `send(type, payload?)` function. The remote subscribes via
  `onCommand(handler)` inside `onBeforeMount` (provided by `createMFEntry`).
  All subscriptions are cleaned up automatically on unmount.

- **`onStatusChange`** — lifecycle status hook for `MFBridgeLazy`.  
  Fires `'loading'` at the start of every load cycle (including manual retries),
  `'ready'` when the remote is mounted, and `'error'` when all attempts fail.

- **`timeout`** — per-attempt load timeout for `MFBridgeLazy`.  
  If a single attempt does not resolve within the given milliseconds it is
  treated as a failure and the retry logic kicks in.

- **`onError(err, retry)`** — manual retry callback for `MFBridgeLazy`.  
  The second argument is a stable `retry()` function that triggers a fresh load
  cycle bypassing the preload cache.

- **`errorFallback`** — separate ReactNode shown when all load attempts fail,
  overriding `fallback` in the error state only.

- **`containerProps`** — HTML attributes forwarded to the mount-point element
  (`id`, `style`, `data-*`, ARIA attributes, etc.) for both `MFBridge` and
  `MFBridgeLazy`. The internal `ref` is never overridden.

- **`clearPreloadCache(loader?)`** — evicts one or all entries from the
  preload cache. Useful after a background deploy or on user logout.

- **`TypedOnEvent<Events>`** — utility type for type-safe `onEvent` handlers
  on the host side.

- **`TypedEmit<Events>`** — utility type for type-safe `emit` calls on the
  remote side inside `onBeforeMount`.

- **`namespace` and `emit`** passed to `createMFEntry`'s `onBeforeMount` opts,
  enabling DI wiring and event emission before the first render.

### Fixed

- `MFEntryErrorBoundary` `children` prop made optional (`children?: ReactNode`)
  to satisfy TypeScript's strict overload checking with `createElement`.

---

## [0.1.0] — 2026-04-09

Initial release.

### Added

- **`MFBridge`** — synchronous host component. Mounts a remote React component
  into a host shell and streams prop updates via DOM CustomEvents.

- **`MFBridgeLazy`** — async host component. Lazily loads a remote module,
  renders a `fallback` while loading, then switches to `MFBridge`.
  Supports `retryCount`, `retryDelay`, `onLoad`, `onError`, and `debug`.

- **`createMFEntry`** — remote-side factory. Wraps a React component for
  mounting by the host, with `onBeforeMount`, `onBeforeUnmount`, and
  an error boundary that auto-resets on the next prop update.

- **`preloadMF(loader)`** — pre-warms the load cache before `MFBridgeLazy`
  renders to cut Time-to-Interactive.

- **`DOMEventBus`** — lightweight CustomEvent bus tied to a single HTMLElement.
  Used internally and exported for advanced use cases.

- **`RegisterFn<P>`**, **`MFProps<T>`**, **`MFLazyProps<T>`** — TypeScript
  helpers for typing the host↔remote contract.
