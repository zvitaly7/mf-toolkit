# Changelog

All notable changes to `@mf-toolkit/mf-ssr` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
