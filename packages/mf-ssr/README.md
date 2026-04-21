# `@mf-toolkit/mf-ssr`

[![npm version](https://img.shields.io/npm/v/@mf-toolkit/mf-ssr?color=CB3837&logo=npm)](https://www.npmjs.com/package/@mf-toolkit/mf-ssr)
[![license](https://img.shields.io/npm/l/@mf-toolkit/mf-ssr?color=blue)](https://github.com/zvitaly7/mf-toolkit/blob/main/LICENSE)
[![react](https://img.shields.io/badge/react-18%20%7C%2019%20%7C%2020-61DAFB?logo=react)](https://react.dev)

**Out-of-box SSR for microfrontends in a polyrepo.** Render the remote MF inside the host's SSR response, hydrate it on the client, and let host state drive remote re-renders automatically — no extra wiring, no async-RSC gymnastics, no manual bridge on the host side.

Two modes, one component (`<MFBridgeSSR>`):

- **`loader` mode** — remote lives on S3/CDN / Module Federation as usual; host imports the component directly and renders it inline. No extra server needed on the remote side. Prop updates flow as a normal React re-render.
- **`url` mode** — remote exposes an HTTP fragment endpoint; host fetches its HTML during SSR and inlines it. After hydration, host prop changes are streamed to the remote via a `DOMEventBus`. Works with any remote stack (React, Vue, Svelte, vanilla).

Zero production dependencies (aside from the tiny internal bridge from `@mf-toolkit/mf-bridge`). Works on Cloudflare Workers, Vercel Edge, Bun, and Node 18+.

---

## The problem

`@mf-toolkit/mf-bridge` alone mounts microfrontend components on the **client** — after JS loads, after the remote bundle downloads, after React hydrates. For a host page rendered with SSR, the MF slot stays empty until all that happens:

```
Browser receives host HTML   Browser downloads JS   MF bundle loads    MF renders
         │                          │                     │                 │
─────────●──────────────────────────●─────────────────────●─────────────────●────▶
         ↑                                                                   ↑
    FCP: host renders                                                  MF visible
    (MF slot empty)                                               (100–600 ms later)
```

The consequence: layout shift, blank content in crawlers, degraded Core Web Vitals.

`mf-ssr` fixes it while keeping the part host developers care about most: **host state still drives the remote.** When the host re-renders with new props (e.g. the current user changes, a step advances, a filter updates), the remote re-renders too — automatically.

---

## Choosing a mode

| | `loader` mode | `url` mode |
|---|---|---|
| Remote infrastructure | S3/CDN only, no server | Needs HTTP fragment endpoint |
| Remote framework | React only | Any (React, Vue, Svelte…) |
| Host-side integration | `<MFBridgeSSR loader={…} />` | `<MFBridgeSSR url={…} namespace={…} />` |
| Remote client hydration | Automatic (host React tree) | `hydrateWithBridge()` in remote bundle |
| Isolation | Inline in host tree | Full (separate React root) |
| Prop streaming on host re-render | Native React re-render | DOM CustomEvents (`DOMEventBus`) |
| Best for | React-only stack with S3 remotes | Polyrepo teams, non-React remotes |

Both modes use the same `<MFBridgeSSR>` component — just swap `url` for `loader`.

---

## Installation

```bash
# host app
npm install @mf-toolkit/mf-ssr

# remote app (url mode — for the fragment endpoint and client hydration)
npm install @mf-toolkit/mf-ssr @mf-toolkit/mf-bridge
```

Peer dependencies:
```bash
npm install react@^18 react-dom@^18
```

---

## Mode 1 — `loader`: remote on S3/CDN, host renders inline

No extra server on the remote side. The host imports the component at SSR time and renders it directly inside its own React tree. Host state changes just re-render the remote like any other React component.

```tsx
// host-app/app/page.tsx
'use client' // if the page lives inside a client boundary
import { useState } from 'react'
import { MFBridgeSSR } from '@mf-toolkit/mf-ssr'

const loadCabinet = () => import('cabinet/App').then(m => m.CabinetWidget)

export function Cabinet({ userId }: { userId: string }) {
  const [currentUser, setCurrentUser] = useState({ id: userId })
  return (
    <MFBridgeSSR
      loader={loadCabinet}
      props={{ currentUser }}
      fallback={<CabinetSkeleton />}
      errorFallback={<CabinetError />}
    />
  )
}
```

When `currentUser` changes, the remote `<CabinetWidget currentUser={…} />` re-renders automatically.

**Requirements:**
- The remote's exposed module must be importable on the server (no `window`/`document` at module top-level).
- Keep the `loader` reference stable — define it at module scope or wrap in `useCallback`. (The component caches the resolved `React.lazy` by loader reference so Suspense retries reuse the same promise.)

---

## Mode 2 — `url`: remote has an HTTP endpoint

Use this when each remote team owns their own deployment, or when the remote is not React. The remote renders itself to HTML on request; the host fetches the HTML during SSR and hydrates it on the client. Prop updates are streamed via a `DOMEventBus` — no re-fetch.

### Step 1 — Remote: expose a fragment endpoint

```ts
// checkout-remote/fragment.ts
import { createMFReactFragment } from '@mf-toolkit/mf-ssr/fragment'
import { CheckoutWidget } from './CheckoutWidget'

export const handler = createMFReactFragment(CheckoutWidget)
```

Wire it to any HTTP framework:

```ts
// Hono (Node / Bun / Cloudflare Worker)
app.get('/fragment', (c) => handler(c.req.raw))

// Next.js Route Handler
export const GET = handler

// Cloudflare Worker
export default { fetch: handler }
```

### Step 2 — Host: `<MFBridgeSSR url="…" namespace="…" />`

```tsx
// host-app/CheckoutSlot.tsx
'use client'
import { useState } from 'react'
import { MFBridgeSSR } from '@mf-toolkit/mf-ssr'

export function CheckoutSlot({ orderId }: { orderId: string }) {
  const [step, setStep] = useState('summary')
  return (
    <MFBridgeSSR
      url="https://checkout.acme.com/fragment"
      namespace="checkout"
      props={{ orderId, step }}
      fallback={<CheckoutSkeleton />}
      onEvent={(type) => { if (type === 'completed') setStep('confirmation') }}
    />
  )
}
```

### Step 3 — Remote: hydrate on the client with the bridge

```ts
// checkout-remote/client-entry.ts
import { hydrateWithBridge } from '@mf-toolkit/mf-bridge/hydrate'
import { CheckoutWidget } from './CheckoutWidget'

hydrateWithBridge(CheckoutWidget, { namespace: 'checkout' })
```

That's it. Props the host passes into `<MFBridgeSSR>` are:
- Used for the initial SSR fetch → the remote renders HTML with those props.
- Serialized into a `<script data-mf-props>` tag so `hydrateWithBridge` can hydrate with matching props (no mismatch, no re-fetch).
- On every host re-render, dispatched as a `propsChanged` CustomEvent → `hydrateWithBridge` re-renders the remote root with the new props.

**`namespace` is required for the bridge.** Pick any unique string per MF slot and keep it identical on both sides.

---

## Parallel composition

Multiple fragments resolve in parallel. Each `<MFBridgeSSR>` is its own Suspense boundary — whichever resolves first streams to the browser first:

```tsx
<MFBridgeSSR url="https://header.acme.com/fragment" namespace="header" props={{ user }} fallback={<HeaderSkeleton />} />
<MFBridgeSSR loader={loadCheckout} props={{ orderId }} fallback={<CheckoutSkeleton />} />
<MFBridgeSSR url="https://recs.acme.com/fragment" namespace="recs" props={{ userId }} fallback={<RecsSkeleton />} />
```

Modes can be mixed freely on the same page.

---

## Graceful degradation — combining with `mf-bridge`

Pass `errorFallback` to render something when fetch/loader fails. A common pattern is to degrade to fully-client-side rendering via `MFBridgeLazy`:

```tsx
import { MFBridgeSSR } from '@mf-toolkit/mf-ssr'
import { MFBridgeLazy } from '@mf-toolkit/mf-bridge'

<MFBridgeSSR
  url="https://checkout.acme.com/fragment"
  namespace="checkout"
  props={{ orderId }}
  timeout={2000}
  fallback={<CheckoutSkeleton />}
  errorFallback={
    <MFBridgeLazy
      register={() => import('checkout/entry').then(m => m.register)}
      props={{ orderId }}
      fallback={<CheckoutSkeleton />}
    />
  }
/>
```

| Scenario | What the user sees |
|---|---|
| Remote healthy | Full SSR HTML on first paint |
| Remote down / timeout | `MFBridgeLazy` mounts after JS hydration |

---

## API

### `<MFBridgeSSR>` · `@mf-toolkit/mf-ssr`

Client-boundary component that renders a remote MF during SSR and keeps it in sync with host props after hydration.

```tsx
// url mode
<MFBridgeSSR
  url="https://checkout.acme.com/fragment"
  namespace="checkout"
  props={{ orderId: '42' }}
  fallback={<Skeleton />}
  errorFallback={<Error />}
  timeout={3000}
  onEvent={(type, payload) => { /* handle remote events */ }}
  commandRef={commandRef}
/>

// loader mode
<MFBridgeSSR
  loader={loadCheckout}
  props={{ orderId: '42' }}
  fallback={<Skeleton />}
  errorFallback={<Error />}
  timeout={3000}
/>
```

| Prop | Type | Applies to | Description |
|---|---|---|---|
| `url` | `string` | url mode | Fragment endpoint — use this **or** `loader` |
| `loader` | `() => Promise<ComponentType<P>>` | loader mode | Async import — use this **or** `url` |
| `props` | `P` | both | Props forwarded to the remote component |
| `fallback` | `ReactNode` | both | Suspense fallback while loading |
| `errorFallback` | `ReactNode` | both | Shown when fetch / loader fails |
| `timeout` | `number` | both | Abort after N ms, default `3000` |
| `onError` | `(error: Error) => void` | both | Observability callback — called when fetch/loader throws (Sentry, DataDog, etc.) |
| `debug` | `boolean` | both | Emit structured fetch/bus lifecycle logs to the console |
| `namespace` | `string` | url mode | Identifies the CustomEvent bus — must match `hydrateWithBridge` on the remote |
| `onEvent` | `(type, payload) => void` | url mode | Called when the remote emits an event |
| `commandRef` | `{ current: (type, payload?) => void \| null }` | url mode | Populated with a `send` function for imperative commands |
| `fetchOptions` | `Omit<RequestInit, 'signal'>` | url mode | Extra options forwarded to `fetch()` — auth headers, cookies, tracing headers, etc. |
| `cacheKey` | `string` | url mode | Per-user cache-slot suffix — required when `fetchOptions` carries auth so users don't share cached HTML |
| `retryCount` | `number` | url mode | Extra fetch attempts after the first failure, default `0` |
| `retryDelay` | `number` | url mode | Milliseconds between retry attempts, default `1000` |

---

### Retry and observability

```tsx
<MFBridgeSSR
  url="https://checkout.acme.com/fragment"
  namespace="checkout"
  props={{ orderId }}
  retryCount={2}          // 3 attempts total (1 + 2 retries)
  retryDelay={500}        // 500 ms pause between each
  onError={(err) => captureException(err)}
  debug={process.env.NODE_ENV !== 'production'}
/>
```

All retries happen inside the single Suspense promise — the fallback stays visible throughout. `onError` fires once, after all retries are exhausted. `errorFallback` then replaces the fallback in the DOM.

---

### Auth isolation with `cacheKey`

The fragment cache is keyed by `url + props + timeout` by default. When `fetchOptions` carries per-user auth (Bearer token, session cookie), different users would share the same cache slot and see each other's fragments. Set `cacheKey` to a stable per-user identifier:

```tsx
<MFBridgeSSR
  url="https://account.acme.com/fragment"
  namespace="account"
  props={{ view: 'orders' }}
  fetchOptions={{ headers: { authorization: `Bearer ${token}` } }}
  cacheKey={userId}   // each user gets their own cache slot
/>
```

---

### Cache preloading

Call `preloadFragment` in a route loader, `getServerSideProps`, or a parent Server Component to start the fetch before `<MFBridgeSSR>` renders. When the cache is warm at render time, Suspense skips the fallback entirely.

```ts
import { preloadFragment } from '@mf-toolkit/mf-ssr'

// Next.js App Router — kick off fetch in the RSC before streaming
preloadFragment('https://checkout.acme.com/fragment', { orderId })

// Then later in the tree:
<MFBridgeSSR url="https://checkout.acme.com/fragment" props={{ orderId }} ... />
```

Call `clearFragmentCache()` after a remote recovers from an error so the next render starts a fresh fetch instead of replaying the cached rejection:

```ts
import { clearFragmentCache } from '@mf-toolkit/mf-ssr'

// after you detect that the remote is healthy again
clearFragmentCache()
```

---

### Type-safe events

Use `TypedSSROnEvent` to get full type inference on `onEvent` handlers:

```ts
import type { TypedSSROnEvent } from '@mf-toolkit/mf-ssr'

type CheckoutEvents = {
  orderPlaced: { orderId: string }
  cancelled: void
}

const onEvent: TypedSSROnEvent<CheckoutEvents> = (type, payload) => {
  if (type === 'orderPlaced') console.log(payload.orderId) // typed
}

<MFBridgeSSR url="…" namespace="checkout" props={…} onEvent={onEvent} />
```

---

### `createMFReactFragment(Component, opts?)` · `@mf-toolkit/mf-ssr/fragment`

_(url mode only)_ Wraps a React component into a standard Web fetch handler.

```ts
import { createMFReactFragment } from '@mf-toolkit/mf-ssr/fragment'

const handler = createMFReactFragment(MyComponent, {
  id?: string           // fragment id, defaults to Component.displayName ?? Component.name
  cacheControl?: string // Cache-Control header value, default: 'no-store'
  vary?: string         // Vary header value, omitted by default
})
// handler: (req: Request) => Promise<Response>
```

Reads props from `?props=<url-encoded-json>`, renders via `renderToReadableStream`, embeds serialized props in a `<script type="application/json" data-mf-props>` tag, and returns a streaming `Response`.

```ts
// CDN-cacheable public fragment
const handler = createMFReactFragment(ProductCard, {
  cacheControl: 'public, s-maxage=60, stale-while-revalidate=30',
  vary: 'Accept-Language',
})

---

### `hydrateWithBridge(Component, { namespace })` · `@mf-toolkit/mf-bridge/hydrate`

_(url mode only — recommended)_ Remote client bundle entry. Hydrates the server-rendered fragment and subscribes to host-driven prop updates via `DOMEventBus`.

```ts
import { hydrateWithBridge } from '@mf-toolkit/mf-bridge/hydrate'

const teardown = hydrateWithBridge(MyComponent, {
  namespace: 'checkout',              // required — must match host's MFBridgeSSR
  onCommand: (type, payload) => { … } // optional — receive imperative commands
})
```

Returns a teardown function. Safe to call in SSR environments — returns a no-op teardown when `document` is undefined.

---

### `hydrateRemote(Component, opts?)` · `@mf-toolkit/mf-ssr/hydrate`

_(url mode only — one-shot)_ Lighter alternative to `hydrateWithBridge`. Reads the serialized props from the `<script data-mf-props>` tag and calls `hydrateRoot`. Does **not** wire up the `DOMEventBus`, so host prop changes after initial hydration won't reach the remote.

Use `hydrateRemote` when:
- The remote is purely presentational — no ongoing prop updates needed after first render.
- You want the smallest possible client bundle and the remote is self-contained.

Use `hydrateWithBridge` when the host needs to stream prop changes, send commands, or receive events from the remote.

```ts
import { hydrateRemote } from '@mf-toolkit/mf-ssr/hydrate'

hydrateRemote(MyComponent)
```

---

## Package exports

| Import path | Use in | Contains |
|---|---|---|
| `@mf-toolkit/mf-ssr` | Host (server + client) | `MFBridgeSSR`, `preloadFragment`, `clearFragmentCache`, types |
| `@mf-toolkit/mf-ssr/fragment` | Remote server | `createMFReactFragment` |
| `@mf-toolkit/mf-ssr/hydrate` | Remote client bundle | `hydrateRemote` (one-shot, no prop streaming) |
| `@mf-toolkit/mf-bridge/hydrate` | Remote client bundle | `hydrateWithBridge` (full streaming — recommended for url mode) |

`MFBridgeSSR` is a client-boundary component: it renders server-side during SSR (including `renderToReadableStream`), hydrates on the client, and re-renders with the parent's state. No manual host-side wiring needed beyond embedding it in your tree.

---

## Integration examples

The `examples/` folder contains runnable integration setups:

| Example | Path | What it shows |
|---|---|---|
| Next.js App Router | `examples/nextjs/` | Host client component + RSC preloading + remote Route Handler + `hydrateWithBridge` client entry |
| Cloudflare Worker + Hono | `examples/cloudflare-hono/` | Fragment endpoint with CDN `Cache-Control` on a Cloudflare Worker |
| Bun | `examples/bun/` | Standalone fragment server + host server with `preloadFragment` |

---

## Benchmarks

The `bench/` folder contains Vitest benchmarks for the SSR hot paths:

- **`dom-event-bus.bench.ts`** — `DOMEventBus.send` throughput with 0/1/10/100 listeners (baseline for url-mode prop streaming)
- **`ssr-loader.bench.ts`** — `renderToReadableStream` with 1/5/20 `<MFBridgeSSR>` loader-mode fragments (edge TTFB path)
- **`prop-streaming.bench.ts`** — end-to-end url-mode `setState` → `propsChanged` dispatch (steady-state after hydration)

Run locally:

```bash
npm run bench
```

Indicative numbers on a modest dev machine (Node 20, jsdom):

| Hot path | ops/sec |
|---|---|
| `DOMEventBus.send` — 1 listener | ~128k |
| `DOMEventBus.send` — 10 listeners | ~50k |
| `DOMEventBus.send` — 100 listeners | ~7k |
| SSR loader-mode — 1 fragment | ~24k |
| SSR loader-mode — 5 fragments | ~7.5k |
| SSR loader-mode — 20 fragments | ~2k |
| url-mode end-to-end (1 listener) | ~250k |
| url-mode end-to-end (10 listeners) | ~237k |

Absolute numbers are machine-dependent; use them to spot regressions, not as SLOs.
