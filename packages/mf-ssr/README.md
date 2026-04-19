# `@mf-toolkit/mf-ssr`

[![npm version](https://img.shields.io/npm/v/@mf-toolkit/mf-ssr?color=CB3837&logo=npm)](https://www.npmjs.com/package/@mf-toolkit/mf-ssr)
[![license](https://img.shields.io/npm/l/@mf-toolkit/mf-ssr?color=blue)](https://github.com/zvitaly7/mf-toolkit/blob/main/LICENSE)
[![react](https://img.shields.io/badge/react-18%20%7C%2019%20%7C%2020-61DAFB?logo=react)](https://react.dev)

**Server-side rendered microfrontend fragments for polyrepo Module Federation.** The host fetches all MF fragments during SSR and composes them into a single streaming response — without a shared build or orchestration layer.

Two modes, one component:

- **`url` mode** — remote exposes an HTTP fragment endpoint; host fetches its HTML during SSR. Works with any remote stack (React, Vue, Svelte, vanilla).
- **`loader` mode** — remote lives on S3/CDN as usual; host imports the component directly and renders it inline. No extra server needed on the remote side.

Zero production dependencies. Works on Cloudflare Workers, Vercel Edge, Bun, and Node 18+.

---

## The problem

`@mf-toolkit/mf-bridge` mounts microfrontend components on the **client** — after JS loads, after the remote bundle downloads, after React hydrates. For a host page rendered with SSR, the MF slot stays empty until all that happens:

```
Browser receives host HTML   Browser downloads JS   MF bundle loads    MF renders
         │                          │                     │                 │
─────────●──────────────────────────●─────────────────────●─────────────────●────▶
         ↑                                                                   ↑
    FCP: host renders                                                  MF visible
    (MF slot empty)                                               (100–600 ms later)
```

The consequence: layout shift, blank content in crawlers, degraded Core Web Vitals.

---

## Choosing a mode

| | `url` mode | `loader` mode |
|---|---|---|
| Remote infrastructure | Needs HTTP endpoint | S3/CDN only, no server |
| Remote framework | Any (React, Vue, Svelte…) | React only |
| Client hydration | `hydrateRemote()` in remote bundle | Automatic (host React tree) |
| Isolation | Full (separate render) | Inline in host tree |
| Best for | Independent remote teams, non-React remotes | Simple setups, all-React monorepo with S3 remotes |

Both modes use the same `<MFBridgeSSR>` component — just swap `url` for `loader`.

---

## Installation

```bash
# in the host app
npm install @mf-toolkit/mf-ssr

# in the remote app (fragment endpoint + client hydration — url mode only)
npm install @mf-toolkit/mf-ssr
```

Peer dependencies:
```bash
npm install react@^18 react-dom@^18
```

---

## Mode 1 — `url`: remote has an HTTP endpoint

Use this when each remote team owns their own deployment. The remote renders its component to HTML and streams it over HTTP. The host fetches the HTML during SSR and injects it into the page.

### Step 1 — Remote: expose a fragment endpoint

```tsx
// checkout-remote/src/fragment.ts
import { createMFReactFragment } from '@mf-toolkit/mf-ssr/fragment'
import { CheckoutWidget } from './CheckoutWidget'

export const handler = createMFReactFragment(CheckoutWidget)
// handler: (req: Request) => Promise<Response>
```

Wire it to your server. Any HTTP framework works:

```ts
// Hono (Node / Bun / Cloudflare Worker)
app.get('/fragment', (c) => handler(c.req.raw))

// Next.js Route Handler
export const GET = handler

// Cloudflare Worker
export default { fetch: handler }
```

### Step 2 — Host: `<MFBridgeSSR url="..." />`

```tsx
// host-app/src/app/page.tsx (Next.js App Router)
import { Suspense } from 'react'
import { MFBridgeSSR } from '@mf-toolkit/mf-ssr'

export default function Page({ searchParams }) {
  return (
    <Suspense fallback={<CheckoutSkeleton />}>
      <MFBridgeSSR
        url="https://checkout.acme.com/fragment"
        props={{ orderId: searchParams.orderId }}
      />
    </Suspense>
  )
}
```

### Step 3 — Remote: hydrate on the client

```ts
// checkout-remote/src/client-entry.ts
import { hydrateRemote } from '@mf-toolkit/mf-ssr/hydrate'
import { CheckoutWidget } from './CheckoutWidget'

hydrateRemote(CheckoutWidget)
```

Load this script in the host page (via Module Federation, `<script>` tag, or script injection in Next.js config). `hydrateRemote` reads the serialized props from the `<script data-mf-props>` tag embedded by the fragment endpoint and calls `React.hydrateRoot` — no extra network round-trip.

---

## Mode 2 — `loader`: remote on S3/CDN, host renders inline

Use this when the remote is a standard MF bundle on S3/CDN with no dedicated server. The host imports the component at SSR time and renders it directly inside its own React tree.

No changes to the remote app. No extra server. Just point the host at the component:

```tsx
// host-app/src/app/page.tsx (Next.js App Router)
import { Suspense } from 'react'
import { MFBridgeSSR } from '@mf-toolkit/mf-ssr'

export default function Page({ searchParams }) {
  return (
    <Suspense fallback={<CheckoutSkeleton />}>
      <MFBridgeSSR
        loader={() => import('checkout/App').then(m => m.CheckoutWidget)}
        props={{ orderId: searchParams.orderId }}
      />
    </Suspense>
  )
}
```

The component renders inline as part of the host React tree. Client hydration is automatic — the same `loader` import resolves on the client via Module Federation's runtime, and React hydrates the server-rendered markup without a mismatch.

**Requirement:** the remote's exposed module must be importable on the server (no `window`/`document` at module top-level). Most React components satisfy this; if yours don't, use `url` mode instead.

---

## Parallel composition

Multiple fragments are fetched in parallel automatically. Each `<MFBridgeSSR>` is an independent async component; whichever resolves first streams to the browser first:

```tsx
<Suspense fallback={<HeaderSkeleton />}>
  <MFBridgeSSR url="https://header.acme.com/fragment" props={{ user }} />
</Suspense>

<Suspense fallback={<CheckoutSkeleton />}>
  <MFBridgeSSR loader={() => import('checkout/App')} props={{ orderId }} />
</Suspense>

<Suspense fallback={<RecommendationsSkeleton />}>
  <MFBridgeSSR url="https://recs.acme.com/fragment" props={{ userId }} />
</Suspense>
```

Modes can be mixed freely — url and loader fragments on the same page.

---

## Graceful degradation — combining with `mf-bridge`

If a fragment fails (remote server down, timeout, import error), pass a `degradeFallback` that falls back to client-side rendering via `@mf-toolkit/mf-bridge`:

```tsx
import { MFBridgeSSR } from '@mf-toolkit/mf-ssr'
import { MFBridgeLazy } from '@mf-toolkit/mf-bridge'

<Suspense fallback={<CheckoutSkeleton />}>
  <MFBridgeSSR
    url="https://checkout.acme.com/fragment"
    props={{ orderId }}
    timeout={2000}
    degradeFallback={
      <MFBridgeLazy
        register={() => import('checkout/entry').then(m => m.register)}
        props={{ orderId }}
        fallback={<CheckoutSkeleton />}
      />
    }
  />
</Suspense>
```

| Scenario | What the user sees |
|---|---|
| Remote server healthy | Full SSR HTML on first paint |
| Remote server down / timeout | Page still loads; `MFBridgeLazy` mounts after JS hydration |

---

## API reference

### `<MFBridgeSSR>` · `@mf-toolkit/mf-ssr`

Async React Server Component. Renders a remote MF fragment during SSR, either by fetching it from an HTTP endpoint (`url`) or by importing and rendering the component inline (`loader`).

```tsx
// url mode
<MFBridgeSSR
  url="https://checkout.acme.com/fragment"
  props={{ orderId: '42' }}
  fallback={<Skeleton />}
  timeout={3000}
  degradeFallback={<MFBridgeLazy … />}
  errorFallback={<div>Unavailable</div>}
/>

// loader mode
<MFBridgeSSR
  loader={() => import('checkout/App').then(m => m.CheckoutWidget)}
  props={{ orderId: '42' }}
  fallback={<Skeleton />}
  timeout={3000}
  degradeFallback={<MFBridgeLazy … />}
/>
```

| Prop | Type | Description |
|---|---|---|
| `url` | `string` | Fragment endpoint URL — use this **or** `loader`, not both |
| `loader` | `() => Promise<ComponentType<P>>` | Async import of the remote component — use this **or** `url` |
| `props` | `P` | Props forwarded to the remote component |
| `fallback` | `ReactNode` | Shown by the Suspense boundary while loading |
| `timeout` | `number` | Abort after N ms, default `3000` |
| `degradeFallback` | `ReactNode` | Rendered when the fragment fails (preferred over `errorFallback`) |
| `errorFallback` | `ReactNode` | Rendered when the fragment fails (if `degradeFallback` not set) |

---

### `createMFReactFragment(Component, opts?)` · `@mf-toolkit/mf-ssr/fragment`

_(url mode only)_ Wraps a React component into a standard Web fetch handler.

```ts
import { createMFReactFragment } from '@mf-toolkit/mf-ssr/fragment'

const handler = createMFReactFragment(MyComponent, {
  id?: string   // fragment identifier, defaults to Component.displayName ?? Component.name
})
// handler: (req: Request) => Promise<Response>
```

Reads props from `?props=<url-encoded-json>`, renders via `renderToReadableStream`, embeds serialized props in a `<script type="application/json" data-mf-props>` tag, and returns a streaming `Response`.

---

### `hydrateRemote(Component, opts?)` · `@mf-toolkit/mf-ssr/hydrate`

_(url mode only)_ Hydrates server-rendered fragment containers. Call once in the remote's client bundle.

```ts
import { hydrateRemote } from '@mf-toolkit/mf-ssr/hydrate'

hydrateRemote(MyComponent, {
  id?: string       // hydrate only [data-mf-ssr="id"], default: all [data-mf-ssr]
  selector?: string // override with any CSS selector
})
```

Safe to call in SSR environments — returns immediately when `document` is undefined.

---

## Package exports

| Import path | Use in | Contains |
|---|---|---|
| `@mf-toolkit/mf-ssr` | Host server (RSC / SSR) | `MFBridgeSSR`, types |
| `@mf-toolkit/mf-ssr/fragment` | Remote server | `createMFReactFragment` |
| `@mf-toolkit/mf-ssr/hydrate` | Remote client bundle | `hydrateRemote` |

Tree-shakeable. Each path has no dependency on the others.
`/fragment` and `/hydrate` are only needed for `url` mode.
