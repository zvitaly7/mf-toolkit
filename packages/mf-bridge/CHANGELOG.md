# Changelog

All notable changes to `@mf-toolkit/mf-bridge` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-04-24

First stable release. No breaking API changes — everything from 0.4.0 keeps working.

### Added

- **`onError` on `MFBridgeHydrated`** — observability callback fired when the
  `[data-mf-namespace]` container is not in the DOM. Use for Sentry / DataDog
  to catch namespace mismatches between `MFBridgeSSR`, `MFBridgeHydrated`, and
  `hydrateWithBridge` in production.

- **`examples/` folder** — integration patterns for React and Vue (via
  `defineMFEntry`) remotes plus a host-app `CheckoutSlot` showing `retryCount`,
  `commandRef`, `TypedOnEvent`, and `preloadMF` in context.

- **`bench/` folder** — Vitest benchmarks for the hot paths:
  `DOMEventBus.send` throughput (1/10/100 listeners), `on + unsub` cycle,
  `MFBridge` mount/unmount cycle, and prop-update throughput. Run with
  `npm run bench`.

- **`LICENSE` file** — MIT license now distributed inside the package (npm
  ships the in-package file verbatim).

### Fixed

- **`preloadCache` is now bounded** — capped at 50 entries with LRU eviction.
  Previously the cache grew without limit, leaking memory in long-lived apps
  that created loader references inline. Stable module-level loaders (the
  recommended pattern) are unaffected.

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

## [0.3.0] — 2026-04-19

### Added

- **`defineMFEntry`** — framework-agnostic alternative to `createMFEntry`.
  Accepts `{ mount, update, unmount }` callbacks instead of a React component,
  enabling Vue, Angular, Svelte, and vanilla JS remotes to integrate with
  `MFBridge` / `MFBridgeLazy` without any React dependency on the remote side.
  Available at `@mf-toolkit/mf-bridge/define-entry`.

- **`shadowDom` prop** on `MFBridge` and `MFBridgeLazy` — attaches a Shadow DOM
  to the mount-point element and renders the remote inside it. Provides native
  CSS isolation: host styles do not bleed into the MF and vice versa. The shadow
  root is passed to `createMFEntry`'s `onBeforeMount` (and `defineMFEntry`'s
  `mount`) so the remote can inject its own styles.

- **`adoptHostStyles` prop** on `MFBridge` and `MFBridgeLazy` — when used with
  `shadowDom`, automatically clones all `<style>` and `<link rel="stylesheet">`
  elements from `document.head` into the shadow root and attaches a
  `MutationObserver` to forward stylesheets injected after mount (lazy CSS-in-JS,
  Tailwind CDN). Cleaned up automatically on unmount.

- **`forwardHostStyles(shadowRoot)`** — exported utility. Called internally by
  `adoptHostStyles`; also available for manual use inside `onBeforeMount` when
  the remote wants full control over style forwarding.

- **`mountRef` prop** on `MFBridge` and `MFBridgeLazy` — ref populated with the
  mount-point `HTMLElement` after mount and cleared on unmount.

- **`containerProps` prop** on `MFBridge` and `MFBridgeLazy` — HTML attributes
  forwarded to the mount-point element (`id`, `style`, `data-*`, ARIA, etc.).

- **Auto-generated unique namespace** — when the `namespace` prop is omitted,
  each `MFBridge` / `MFBridgeLazy` instance receives a stable unique namespace
  (`mfbridge-1`, `mfbridge-2`, …) so debug logs distinguish concurrent instances
  of the same MF. Explicit `namespace` prop is respected as-is.

- **`onCommand` in `createMFEntry` `onBeforeMount` opts** — the remote can
  subscribe to imperative commands sent by the host via `commandRef`. All
  subscriptions are cleaned up automatically on unmount.

- **`shadowRoot` in `createMFEntry` `onBeforeMount` opts** — provided when the
  host enables `shadowDom`, so the remote can inject its own styles via
  `adoptedStyleSheets` or a `<style>` element.

- **`./define-entry` package export** — tree-shakeable entry point for non-React
  remotes. Importing from `@mf-toolkit/mf-bridge/define-entry` does not include
  React or host-side code.

### Changed

- `namespace` prop on `MFBridge` and `MFBridgeLazy` is now optional with no
  explicit default — each instance auto-generates a unique stable namespace.
  Existing code passing an explicit `namespace` is unaffected.

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
