# Changelog

All notable changes to `@mf-toolkit/mf-ssr` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-06-18

### Added

- **`onError` on `hydrateRemote` and `createMFReactFragment`.** Malformed
  `[data-mf-props]` (client) / `?props=` (server) JSON is now surfaced through an
  optional `onError` callback instead of being swallowed silently; the component
  still renders with empty props. A malformed payload usually means the SSR
  serializer and the client bundle disagree on the props shape.

- **Targeted `clearFragmentCache(url, props, opts?)`.** Evict a single
  fragment-cache entry instead of flushing the whole cache — avoids re-fetching
  every healthy fragment on a long-lived SSR/edge server after one remote
  recovers. The previous JSDoc described this form, but the implementation only
  ever cleared the entire cache; calling with no arguments still flushes all.

### Fixed

- **`createMFReactFragment` returns `500` on render failure.** If the component
  throws during server render, the handler now returns a `500` response (and
  calls `onError`) instead of rejecting the request promise — which previously
  could crash the remote's request handler or leak a stack trace to the client.

- **Loader-mode failures can recover.** A rejected `React.lazy` was cached
  indefinitely (keyed by loader reference) with no reset path, so a transient
  loader timeout/failure stayed broken until a full page reload. The loader
  cache is now a bounded `Map` that `clearFragmentCache()` also resets.

---

## [1.0.2] — 2026-05-05

Version bumped to align with [`@mf-toolkit/mf-bridge@1.0.2`](../mf-bridge/CHANGELOG.md);
no `1.0.1` was published. No API changes.

### Added

- **Dev-only emitter for `@mf-toolkit/mf-devtools`.** The package now calls
  `window.__MF_DEVTOOLS_HOOK__.emit(...)` at every fragment mount, unmount,
  propsChanged, host↔remote event, and the full SSR fetch lifecycle
  (`start` → `retry` → `ok` / `error`) for both URL-mode and loader-mode
  fragments.

  The emitter is gated behind `process.env.NODE_ENV !== 'production'`, so
  the entire `_devtools` module is dead-code-eliminated by webpack / Vite /
  esbuild in production builds. **Zero runtime cost in production**, no new
  dependencies, no API surface change.

  See [`@mf-toolkit/mf-devtools`](../mf-devtools) for the panel itself.

---

## [1.0.0] — 2026-04-20

### Added

- **`retryCount` + `retryDelay` props** (url mode) — failed fetches are retried up to
  `retryCount` additional times with a `retryDelay` ms gap between attempts. All retries
  happen inside the single Suspense promise so the fallback stays visible throughout;
  `errorFallback` fires only after all retries are exhausted.

- **`fetchOptions` prop** (url mode) — extra options forwarded verbatim to `fetch()`.
  Use for auth headers, session cookies, distributed-tracing headers, etc.

- **`cacheKey` prop** (url mode) — explicit suffix appended to the fragment cache key.
  Required when `fetchOptions` carries per-user auth so different users don't share the
  same cached HTML.

- **`onError` prop** — observability callback fired when the fragment fetch or loader
  throws. Use for Sentry / DataDog / custom error tracking without replacing the visual
  `errorFallback`.

- **`debug` prop** — emits structured `[mf-ssr]` console logs for fetch lifecycle,
  prop streaming, and bus events. Keep off in production.

- **`TypedSSROnEvent<Events>` utility type** — type-safe helper for `onEvent` handlers.
  Narrows `payload` to the correct type for each event key.

- **`preloadFragment(url, props, opts?)`** — pre-warms the url-mode fragment cache before
  `<MFBridgeSSR>` mounts. When called in a route loader or Server Component the fetch is
  already in-flight (or resolved) by render time — Suspense skips the fallback entirely.

- **`clearFragmentCache()`** — evicts all entries from the url-mode fragment cache.
  Call after a remote recovers from an error so the next render starts a fresh fetch.

- **`createMFReactFragment` cache-control options** — `cacheControl` (default: `'no-store'`)
  and `vary` let each fragment endpoint declare its own CDN caching strategy independently
  of the host.

### Security

- **XSS-safe props serialization** in `createMFReactFragment` — `<`, `>`, `&`, U+2028,
  and U+2029 are escaped inside the embedded `<script type="application/json" data-mf-props>`
  block, eliminating script-injection risk from remote-provided prop values.

### Fixed

- **URL length guard** — url mode now rejects props payloads that would exceed 4 096 chars
  (conservative CDN / reverse-proxy safe limit) with a descriptive error rather than
  producing a silent 414 or truncated fetch.

- **Fragment cache size cap** — the url-mode cache is bounded at 50 entries (LRU-evict on
  overflow) to prevent unbounded memory growth on long-lived edge workers.

- **Suspense / ErrorBoundary correctness** — rejected fetch promises stay in the fragment
  cache across Suspense retries. Previously, evicting them caused an infinite
  suspend-then-miss loop that prevented ErrorBoundary from ever firing.

---

## [0.2.0] — 2026-04-19

### Added

- **`loader` mode for `MFBridgeSSR`** — alternative to `url` mode for remotes hosted on S3/CDN
  without a dedicated HTTP server. Pass a `loader` function (dynamic import of the component)
  instead of a `url`; the host imports and renders the component inline during SSR.
  Client hydration is automatic — the same import resolves via Module Federation's runtime.

- **`MFBridgeSSRProps` is now a discriminated union** — `url` and `loader` props are mutually
  exclusive at the type level; TypeScript will error if both are provided.

---

## [0.1.0] — 2026-04-19

Initial release.

### Added

- **`MFBridgeSSR`** — async React Server Component. Fetches a remote MF fragment during SSR
  and injects its HTML into the host page. Wraps in `Suspense` automatically.
  Supports `timeout`, `degradeFallback`, and `errorFallback`.

- **`createMFReactFragment`** — wraps a React component into a standard
  `(req: Request) => Promise<Response>` handler. Uses `renderToReadableStream`
  for edge-compatible streaming. Embeds serialized props in a
  `<script type="application/json" data-mf-props>` tag for client hydration.

- **`hydrateRemote`** — client-side hydration helper. Finds `[data-mf-ssr]` containers,
  reads the embedded props, and calls `React.hydrateRoot`. Safe in SSR environments.
