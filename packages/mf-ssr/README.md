# `@mf-toolkit/mf-ssr`

[![npm version](https://img.shields.io/npm/v/@mf-toolkit/mf-ssr?color=CB3837&logo=npm)](https://www.npmjs.com/package/@mf-toolkit/mf-ssr)
[![license](https://img.shields.io/npm/l/@mf-toolkit/mf-ssr?color=blue)](https://github.com/zvitaly7/mf-toolkit/blob/main/LICENSE)
[![react](https://img.shields.io/badge/react-18%20%7C%2019%20%7C%2020-61DAFB?logo=react)](https://react.dev)

**Server-side rendered microfrontend fragments for polyrepo Module Federation.** Each remote streams its own HTML over HTTP. The host fetches all fragments in parallel and composes them into a single response — without a shared build or orchestration layer.

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

## How it works

`mf-ssr` splits the work across three small pieces:

```
REMOTE SERVER                    HOST SERVER                   BROWSER
─────────────                    ───────────                   ───────

createMFReactFragment            MFBridgeSSR                   hydrateRemote
      │                               │                              │
      │  HTTP GET /fragment?props=…   │                              │
      │◄──────────────────────────────│                              │
      │                               │                              │
      │  streams HTML + props JSON    │                              │
      │──────────────────────────────►│                              │
      │                               │                              │
      │                       inlines HTML into               reads serialized props
      │                       host SSR response               from <script> tag,
      │                               │                       calls hydrateRoot()
      │                               │──────────────────────────────►
```

1. **Remote** — `createMFReactFragment(Component)` wraps a React component into a standard `(req: Request) => Promise<Response>` handler. It renders the component to a `ReadableStream` and embeds the serialized props in a `<script>` tag.

2. **Host** — `<MFBridgeSSR url="..." props={...} />` is an async React Server Component. It fetches the fragment HTML during SSR and injects it into the page. Multiple fragments are fetched in parallel via React `Suspense`.

3. **Browser** — `hydrateRemote(Component)` runs in the remote's client bundle. It reads the embedded props and calls `hydrateRoot` on the server-rendered fragment container — no extra network round-trips.

---

## Installation

```bash
# in the host app
npm install @mf-toolkit/mf-ssr

# in the remote app (for the fragment endpoint and client hydration)
npm install @mf-toolkit/mf-ssr
```

Peer dependencies:
```bash
npm install react@^18 react-dom@^18
```

---

## Quick start

This example uses a `checkout` microfrontend with its own server. The host is a Next.js App Router app.

### Step 1 — Remote: expose a fragment endpoint

Set up an HTTP endpoint in your remote app. Any server framework works — Express, Fastify, Hono, Bun, Cloudflare Worker, Next.js Route Handler.

```tsx
// checkout-remote/src/fragment.ts
import { createMFReactFragment } from '@mf-toolkit/mf-ssr/fragment'
import { CheckoutWidget } from './CheckoutWidget'

// Returns a standard (req: Request) => Promise<Response> handler
export const handler = createMFReactFragment(CheckoutWidget)
```

Wire it up to your server. Example with **Hono** (works on Node, Bun, Cloudflare):

```ts
// checkout-remote/src/server.ts
import { Hono } from 'hono'
import { handler } from './fragment'

const app = new Hono()
app.get('/fragment', (c) => handler(c.req.raw))

export default app
```

Example with **Next.js Route Handler** (in the remote's Next.js app):

```ts
// checkout-remote/src/app/fragment/route.ts
import { handler } from '../../fragment'

export const GET = handler
```

Example with **Cloudflare Worker**:

```ts
// checkout-remote/src/worker.ts
import { handler } from './fragment'

export default { fetch: handler }
```

That's all on the remote server side. The endpoint accepts `GET /fragment?props=<json>` and streams back the component HTML.

---

### Step 2 — Host: use `MFBridgeSSR` in a Server Component

```tsx
// host-app/src/app/page.tsx  (Next.js App Router)
import { Suspense } from 'react'
import { MFBridgeSSR } from '@mf-toolkit/mf-ssr'

export default function Page({ searchParams }: { searchParams: { orderId: string } }) {
  return (
    <main>
      <h1>Order summary</h1>

      {/* MFBridgeSSR is an async Server Component.
          Suspense shows the skeleton while the fragment is fetching. */}
      <Suspense fallback={<CheckoutSkeleton />}>
        <MFBridgeSSR
          url="https://checkout.acme.com/fragment"
          props={{ orderId: searchParams.orderId }}
        />
      </Suspense>
    </main>
  )
}
```

`MFBridgeSSR` fetches the checkout fragment HTML **during server rendering**. The page HTML that reaches the browser already contains the checkout widget markup — no blank slot, no layout shift.

Multiple fragments are fetched in parallel automatically because each `<MFBridgeSSR>` is an independent async component:

```tsx
<Suspense fallback={<HeaderSkeleton />}>
  <MFBridgeSSR url="https://header.acme.com/fragment" props={{ user }} />
</Suspense>

<Suspense fallback={<CheckoutSkeleton />}>
  <MFBridgeSSR url="https://checkout.acme.com/fragment" props={{ orderId }} />
</Suspense>

<Suspense fallback={<RecommendationsSkeleton />}>
  <MFBridgeSSR url="https://recommendations.acme.com/fragment" props={{ userId }} />
</Suspense>
```

All three fragments are fetched concurrently. Whichever resolves first streams to the browser first.

---

### Step 3 — Remote: hydrate on the client

In the remote's client-side entry point, call `hydrateRemote`. It finds the server-rendered HTML, reads the embedded props, and hands control to React.

```ts
// checkout-remote/src/client-entry.ts
import { hydrateRemote } from '@mf-toolkit/mf-ssr/hydrate'
import { CheckoutWidget } from './CheckoutWidget'

hydrateRemote(CheckoutWidget)
```

Then load this script in the host page. With Next.js and Module Federation you can use `next.config` script injection; with a vanilla setup just add a `<script>` tag pointing at the remote bundle.

`hydrateRemote` locates the `[data-mf-ssr]` container in the DOM, reads the `<script data-mf-props>` element that was embedded by the remote server, and calls `React.hydrateRoot` — no extra fetch, no flash of unstyled content.

---

## Graceful degradation — combining with `mf-bridge`

If the remote server is unreachable during SSR (deploy, cold start, network timeout), pass a `degradeFallback` that falls back to the client-side `MFBridgeLazy` from `@mf-toolkit/mf-bridge`:

```tsx
import { MFBridgeSSR } from '@mf-toolkit/mf-ssr'
import { MFBridgeLazy } from '@mf-toolkit/mf-bridge'

<Suspense fallback={<CheckoutSkeleton />}>
  <MFBridgeSSR
    url="https://checkout.acme.com/fragment"
    props={{ orderId }}
    timeout={2000}
    degradeFallback={
      // MF server unreachable → render client-only placeholder.
      // The MF bundle still loads after JS hydration.
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
| Remote server down / timeout | Page still loads, `MFBridgeLazy` mounts after JS hydration |
| Remote server slow (> `timeout`) | Same as above |

---

## Complete flow at a glance

```
1. Browser requests /order/42
       │
2. Host SSR starts rendering
       │
3. Hits <MFBridgeSSR url="https://checkout.acme.com/fragment" props={{ orderId: '42' }} />
       │
4. Host fetches https://checkout.acme.com/fragment?props=%7B%22orderId%22%3A%2242%22%7D
       │
5. Checkout remote renders <CheckoutWidget orderId="42" /> to a ReadableStream
   Output HTML:
     <div data-mf-ssr="CheckoutWidget">
       <script type="application/json" data-mf-props>{"orderId":"42"}</script>
       <div data-mf-app>
         <!-- CheckoutWidget rendered HTML -->
         <form class="checkout">...</form>
       </div>
     </div>
       │
6. Host inlines that HTML into its own SSR response
       │
7. Browser renders the full page including checkout widget — no JS needed for first paint
       │
8. Remote client bundle loads, calls hydrateRemote(CheckoutWidget)
       │
9. hydrateRemote reads {"orderId":"42"} from <script data-mf-props>
   calls hydrateRoot(appEl, <CheckoutWidget orderId="42" />)
       │
10. React takes over the server-rendered HTML — widget is now fully interactive
```

---

## API reference

### `createMFReactFragment(Component, opts?)` · `@mf-toolkit/mf-ssr/fragment`

Wraps a React component into a standard Web fetch handler.

```ts
import { createMFReactFragment } from '@mf-toolkit/mf-ssr/fragment'

const handler = createMFReactFragment(MyComponent, {
  id?: string   // fragment identifier, defaults to Component.displayName ?? Component.name
})

// handler: (req: Request) => Promise<Response>
```

The handler reads props from `?props=<url-encoded-json>`, renders the component to a `ReadableStream`, and returns a `Response` with `Content-Type: text/html`.

The rendered HTML is wrapped in:
```html
<div data-mf-ssr="[id]">
  <script type="application/json" data-mf-props>{ ...props }</script>
  <div data-mf-app><!-- component HTML --></div>
</div>
```

---

### `<MFBridgeSSR>` · `@mf-toolkit/mf-ssr`

Async React Server Component. Fetches fragment HTML during SSR, injects it into the page.

```tsx
import { MFBridgeSSR } from '@mf-toolkit/mf-ssr'

<MFBridgeSSR
  url="https://checkout.acme.com/fragment"  // fragment endpoint base URL
  props={{ orderId: '42' }}                 // forwarded as ?props=…
  fallback={<Skeleton />}                   // shown by the wrapping Suspense
  timeout={3000}                            // ms before fetch is aborted (default: 3000)
  degradeFallback={<MFBridgeLazy … />}      // rendered when SSR fetch fails
  errorFallback={<div>Unavailable</div>}    // same, if degradeFallback not set
/>
```

Wrap in `<Suspense fallback={…}>` to show a loading state while the fragment is fetching.

| Prop | Type | Description |
|---|---|---|
| `url` | `string` | Fragment endpoint URL (without `?props=…`) |
| `props` | `object` | Props forwarded to the remote component |
| `fallback` | `ReactNode` | Content shown while Suspense is pending |
| `timeout` | `number` | Fetch timeout in ms, default `3000` |
| `degradeFallback` | `ReactNode` | Rendered when the fetch fails (preferred) |
| `errorFallback` | `ReactNode` | Rendered when the fetch fails (fallback to `degradeFallback`) |

---

### `hydrateRemote(Component, opts?)` · `@mf-toolkit/mf-ssr/hydrate`

Hydrates server-rendered fragment containers in the DOM. Called once in the remote's client bundle.

```ts
import { hydrateRemote } from '@mf-toolkit/mf-ssr/hydrate'

hydrateRemote(MyComponent, {
  id?: string       // hydrate only [data-mf-ssr="id"], default: all [data-mf-ssr]
  selector?: string // override with any CSS selector
})
```

Reads props from the embedded `<script data-mf-props>` and calls `React.hydrateRoot` on `[data-mf-app]`. Safe to call in SSR environments — returns immediately if `document` is undefined.

---

## Package exports

| Import path | Use it in | Contains |
|---|---|---|
| `@mf-toolkit/mf-ssr` | Host server (RSC / SSR) | `MFBridgeSSR`, types |
| `@mf-toolkit/mf-ssr/fragment` | Remote server | `createMFReactFragment` |
| `@mf-toolkit/mf-ssr/hydrate` | Remote client bundle | `hydrateRemote` |

Tree-shakeable: each export path has no dependency on the others.
