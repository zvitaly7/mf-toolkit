# `@mf-toolkit/mf-bridge`

[![npm version](https://img.shields.io/npm/v/@mf-toolkit/mf-bridge?color=CB3837&logo=npm)](https://www.npmjs.com/package/@mf-toolkit/mf-bridge)
[![license](https://img.shields.io/npm/l/@mf-toolkit/mf-bridge?color=blue)](https://github.com/zvitaly7/mf-toolkit/blob/main/LICENSE)
[![react](https://img.shields.io/badge/react-18%20%7C%2019-61DAFB?logo=react)](https://react.dev)

**Mount a microfrontend React component from any Module Federation remote — with lazy loading, automatic prop streaming, and a typed fallback.**

`mf-bridge` replaces the copy-paste `moved_to_mf_*` wrapper pattern. Define once how a remote component should be mounted, and the bridge handles the full lifecycle: lazy load → mount in a dedicated DOM node → stream prop updates via DOM events → clean unmount.

Zero production dependencies. Works with any Module Federation setup.

---

## The problem

When a shell (host) app starts migrating features into separate microfrontends, it needs to mount those remote React components inside its own render tree. A typical first implementation looks like this:

```tsx
// host app — moved_to_mf_checkout.tsx
export function MovedToMfCheckout({ orderId, user }: CheckoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const unmountRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    import('checkout/CheckoutWidget').then(({ register }) => {
      if (cancelled || !containerRef.current) return
      unmountRef.current = register({ mountPointer: containerRef.current, props: { orderId, user } })
    })
    return () => {
      cancelled = true
      unmountRef.current?.()
    }
  }, [])

  useEffect(() => {
    // stream prop changes to the mounted component
    containerRef.current?.dispatchEvent(
      new CustomEvent('checkout_propsChanged', { detail: { orderId, user } }),
    )
  }, [orderId, user])

  return <div ref={containerRef} />
}
```

This is fine for one feature. But it gets copied 25 times. Each copy has the same structure, the same subtle bugs (missing cancellation, prop streaming on first render, leaked listeners), and a hardcoded event prefix (`checkout_`).

Every new remote module needs another copy.

## The solution

`mf-bridge` abstracts this pattern into two components — one for the host, one for the remote — connected through a typed contract.

**Remote side** (inside your MF, in the exposed entry module):

```tsx
// checkout-mf/src/entry.ts
import { createMFEntry } from '@mf-toolkit/mf-bridge/entry'
import { CheckoutWidget } from './CheckoutWidget'

export const register = createMFEntry(CheckoutWidget)
```

**Host side** (inside your shell app):

```tsx
// host/src/features/Checkout.tsx
import { MFBridgeLazy } from '@mf-toolkit/mf-bridge'

export function Checkout({ orderId, user }: CheckoutProps) {
  return (
    <MFBridgeLazy
      register={() => import('checkout/entry').then(m => m.register)}
      props={{ orderId, user }}
      fallback={<LocalCheckoutFallback orderId={orderId} />}
    />
  )
}
```

That's it. The bridge loads the remote module, mounts the component, and automatically streams every subsequent `props` change to it — no boilerplate, no shared module state, no leaked listeners.

## How prop streaming works

When a host React component re-renders with new props, those props need to reach the remote component — which is mounted in a separate `createRoot`, inside its own React tree, potentially from a different bundle.

`mf-bridge` solves this with DOM `CustomEvent`s dispatched on the shared mount-point element. Both sides hold a reference to the same DOM node:

```
Host (React tree)                   Remote (React tree)
─────────────────                   ───────────────────
MFBridgeLazy                        createMFEntry (listens)
  │                                   │
  ├─ creates <mf-bridge> element ─────┘ (same HTMLElement)
  │
  ├─ mounts remote via register()
  │
  └─ on props change:
       element.dispatchEvent(
         new CustomEvent('mfbridge:propsChanged', { detail: newProps })
       )
                                    ↑ remote listener calls root.render()
```

No shared module scope. No global registry. No React context crossing bundle boundaries. Just a DOM event on the element they both already own.

## Why not React portals / React.lazy?

| Scenario | React portals | React.lazy | `mf-bridge` |
|---|:---:|:---:|:---:|
| Component lives in a **separate webpack bundle** | ✗ | ✗ | ✅ |
| Component uses a **separate React root** (`createRoot`) | ✗ | ✗ | ✅ |
| **Lazy load** the remote module | — | ✅ (same bundle only) | ✅ |
| Stream **prop updates** across bundle boundary | ✗ | ✗ | ✅ |
| Show **fallback** while loading | ✗ | ✅ | ✅ |
| **Clean unmount** with listener cleanup | Manual | Manual | ✅ |
| **Type-safe props** inferred from remote's export | ✗ | ✗ | ✅ |
| Zero production dependencies | — | ✅ | ✅ |

React portals render into a different DOM node but stay in the same React tree and bundle — they can't reach across Module Federation boundaries. `React.lazy` defers the import but still requires the component to live in the same bundle and React root.

`mf-bridge` is specifically designed for the cross-bundle, separate-React-root case that Module Federation introduces.

---

## Installation

```bash
npm install @mf-toolkit/mf-bridge
```

Peer dependencies (already installed in any React 18+ app):

```bash
npm install react@^18 react-dom@^18
```

---

## Quick start

### 1. Remote side — expose a register function

In the module your MF exposes via `ModuleFederationPlugin`:

```tsx
// src/entry.ts  (add to `exposes` in your MF webpack config)
import { createMFEntry } from '@mf-toolkit/mf-bridge/entry'
import { CheckoutWidget } from './CheckoutWidget'

export const register = createMFEntry(CheckoutWidget)
```

`createMFEntry` wraps your component and returns a `register` function that the host calls at runtime. It handles `createRoot`, re-renders on prop updates, and cleanup.

### 2. Host side — mount with `MFBridgeLazy`

```tsx
import { MFBridgeLazy } from '@mf-toolkit/mf-bridge'

function Checkout({ orderId }: { orderId: string }) {
  return (
    <MFBridgeLazy
      register={() => import('checkout/entry').then(m => m.register)}
      props={{ orderId }}
      fallback={<Spinner />}
    />
  )
}
```

- `register` — async factory, evaluated once on mount. Typically a dynamic `import()`.
- `props` — forwarded to the remote component. **Type is inferred** from the `register` return type; TypeScript will error if props don't match.
- `fallback` — rendered while the remote module is loading (optional).

### 3. Prop updates are automatic

Just pass new `props` on re-render. The bridge detects changes and streams them to the mounted remote component:

```tsx
function Checkout({ orderId, step }: { orderId: string; step: 'summary' | 'payment' }) {
  // When `step` changes, MFBridgeLazy sends a propsChanged event to the remote.
  // The remote re-renders CheckoutWidget with the new props. No extra code needed.
  return (
    <MFBridgeLazy
      register={() => import('checkout/entry').then(m => m.register)}
      props={{ orderId, step }}
      fallback={<Spinner />}
    />
  )
}
```

---

## DI and setup before first render

Use the `onBeforeMount` callback in `createMFEntry` for anything that must run before the component sees its first props — service injection, DI container setup, global stores:

```tsx
// checkout-mf/src/entry.ts
import { createMFEntry } from '@mf-toolkit/mf-bridge/entry'
import { CheckoutWidget } from './CheckoutWidget'
import { container } from './di'

export const register = createMFEntry(CheckoutWidget, ({ props }) => {
  // Called once, before createRoot. Safe to read initial props here.
  container.set('apiClient', props.apiClient)
  container.set('user', props.user)
})
```

`onBeforeMount` receives `{ mountPointer, props }`. The `mountPointer` is the DOM element the component will mount into — useful if you need to attach non-React content alongside it.

---

## Sync variant: `MFBridge`

When the `register` function is already available (pre-loaded remote, server-rendered shell, test environments), use `MFBridge` directly:

```tsx
import { MFBridge } from '@mf-toolkit/mf-bridge'
import { register } from 'checkout/entry' // pre-loaded

function Checkout({ orderId }: { orderId: string }) {
  return <MFBridge register={register} props={{ orderId }} />
}
```

`MFBridge` mounts the component synchronously in `useEffect` (first paint). No loading state, no fallback.

---

## TypeScript: prop inference

Props are inferred end-to-end from the remote's `register` export. No manual type duplication.

```tsx
// checkout-mf/src/entry.ts
export const register = createMFEntry(CheckoutWidget)
//                                    └─ CheckoutWidget: FC<{ orderId: string; step: Step }>

// host app
<MFBridgeLazy
  register={() => import('checkout/entry').then(m => m.register)}
  props={{ orderId: '123', step: 'payment' }}  // ✅ typed
  //       ↑ TypeScript infers { orderId: string; step: Step } from register
/>

<MFBridgeLazy
  register={() => import('checkout/entry').then(m => m.register)}
  props={{ orderId: '123' }}  // ✗ TypeScript error: missing `step`
/>
```

The utility types `MFProps<T>` and `MFLazyProps<T>` are also exported for manual type extraction when needed:

```tsx
import type { MFLazyProps } from '@mf-toolkit/mf-bridge'

type CheckoutProps = MFLazyProps<typeof checkoutLoader>
// Resolves to ComponentProps<typeof CheckoutWidget>
```

---

## Namespace configuration

By default, prop-streaming events use the `mfbridge` namespace prefix:
`mfbridge:propsChanged`.

When multiple microfrontends are mounted on the same page, all using `mf-bridge`, this is safe — each mount point is a distinct DOM element, so events don't leak between them.

If you need an explicit namespace (e.g. for debugging or for integration with other event systems), set it consistently on both sides:

```tsx
// Remote side
export const register = createMFEntry(CheckoutWidget)
// register accepts `namespace` at call time — set by the host

// Host side
<MFBridgeLazy
  register={() => import('checkout/entry').then(m => m.register)}
  props={{ orderId }}
  namespace="checkout"   // emits `checkout:propsChanged`
/>
```

The `namespace` prop on `MFBridge`/`MFBridgeLazy` is forwarded to `register()` as `opts.namespace`, so both the host-side dispatch and the MF-side listener use the same prefix automatically.

---

## API reference

### `createMFEntry(Component, onBeforeMount?)` — remote side

**Import:** `@mf-toolkit/mf-bridge/entry`

```typescript
function createMFEntry<T extends ComponentType<any>>(
  Component: T,
  onBeforeMount?: (opts: {
    mountPointer: HTMLElement
    props: ComponentProps<T>
  }) => void,
): RegisterFn<ComponentProps<T>>
```

| Parameter | Type | Description |
|---|---|---|
| `Component` | `ComponentType<P>` | React component to expose to the host |
| `onBeforeMount` | `(opts) => void` | Optional. Called once before `createRoot`. Use for DI setup. |

Returns a `RegisterFn<P>` — a function the host calls at mount time.

---

### `RegisterFn<P>` — the contract between host and remote

```typescript
type RegisterFn<P extends object = object> = (opts: {
  mountPointer: HTMLElement   // DOM element to render into
  props: P                    // initial props
  namespace?: string          // event namespace, default 'mfbridge'
}) => () => void              // returns unmount callback
```

This is the type of the value exported from the remote's entry module. The host calls it once. The returned function unmounts the component and removes all listeners.

---

### `<MFBridgeLazy>` — host side, lazy loading

**Import:** `@mf-toolkit/mf-bridge`

```typescript
function MFBridgeLazy<T extends () => Promise<RegisterFn<any>>>(props: {
  register: T
  props: MFLazyProps<T>
  fallback?: ReactNode
  tagName?: string
  namespace?: string
}): JSX.Element
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `register` | `() => Promise<RegisterFn<P>>` | — | Async factory. Evaluated once on mount. |
| `props` | `MFLazyProps<typeof register>` | — | Props forwarded to the remote component. Inferred from `register`. |
| `fallback` | `ReactNode` | `null` | Rendered while the remote module is loading. |
| `tagName` | `string` | `'mf-bridge'` | HTML tag used as the mount-point element. |
| `namespace` | `string` | `'mfbridge'` | CustomEvent namespace for prop streaming. |

---

### `<MFBridge>` — host side, sync

**Import:** `@mf-toolkit/mf-bridge`

```typescript
function MFBridge<T extends RegisterFn<any>>(props: {
  register: T
  props: MFProps<T>
  tagName?: string
  namespace?: string
}): JSX.Element
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `register` | `RegisterFn<P>` | — | Synchronous register function from the remote. |
| `props` | `MFProps<typeof register>` | — | Props forwarded to the remote component. Inferred from `register`. |
| `tagName` | `string` | `'mf-bridge'` | HTML tag used as the mount-point element. |
| `namespace` | `string` | `'mfbridge'` | CustomEvent namespace for prop streaming. |

---

### Utility types

```typescript
// Extracts props type from a synchronous RegisterFn
type MFProps<T> = T extends RegisterFn<infer P> ? P : never

// Extracts props type from a lazy loader () => Promise<RegisterFn<P>>
type MFLazyProps<T> = T extends () => Promise<RegisterFn<infer P>> ? P : never
```

---

### `DOMEventBus` — lower-level API

The event transport used internally by the bridge. Exposed for cases where you need direct control — e.g. sending custom events beyond `propsChanged`, or building additional cross-bundle communication channels.

**Import:** `@mf-toolkit/mf-bridge`

```typescript
class DOMEventBus {
  constructor(element: HTMLElement, namespace: string)

  /** Dispatch a CustomEvent on the element. */
  send<T>(event: string, detail: T): void

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<T>(event: string, handler: (detail: T) => void): () => void
}
```

```tsx
// Custom cross-bundle event (e.g. MF notifying host of navigation)
const bus = new DOMEventBus(mountEl, 'checkout')

// Remote side — emit
bus.send('navigateTo', { page: '/confirmation' })

// Host side — listen
const off = bus.on<{ page: string }>('navigateTo', ({ page }) => {
  hostRouter.push(page)
})
// call off() on cleanup
```

---

## Full example with Module Federation config

```tsx
// ─── checkout MF — webpack.config.js ─────────────────────────────────────────
new ModuleFederationPlugin({
  name: 'checkout',
  filename: 'remoteEntry.js',
  exposes: {
    './entry': './src/entry.ts',   // ← exposes the register function
  },
  shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
})

// ─── checkout MF — src/entry.ts ───────────────────────────────────────────────
import { createMFEntry } from '@mf-toolkit/mf-bridge/entry'
import { CheckoutWidget } from './CheckoutWidget'

export const register = createMFEntry(CheckoutWidget)

// ─── host app — webpack.config.js ─────────────────────────────────────────────
new ModuleFederationPlugin({
  name: 'host',
  remotes: {
    checkout: 'checkout@https://checkout.example.com/remoteEntry.js',
  },
  shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
})

// ─── host app — src/features/Checkout.tsx ────────────────────────────────────
import { MFBridgeLazy } from '@mf-toolkit/mf-bridge'

export function Checkout({ orderId }: { orderId: string }) {
  return (
    <MFBridgeLazy
      register={() => import('checkout/entry').then(m => m.register)}
      props={{ orderId }}
      fallback={<div>Loading checkout…</div>}
    />
  )
}
```

---

## What is not in v0.1

The following are planned for future versions and deliberately excluded from v0.1 to keep the API minimal:

| Feature | Reason for deferral |
|---|---|
| Remote module registry / caching | Separate package: `@mf-toolkit/mf-loader` |
| Type-safe `importRemote` wrapper | Separate package: `@mf-toolkit/mf-loader` |
| `request/response` bidirectional RPC | v0.2 — two-way callback channel across bundles |
| `iframe` transport mode | v0.2 — hard isolation between host and remote |
| URL resolution / DEV port scanning | Separate package: `@mf-toolkit/mf-loader` |

---

## When not to use this package

- Your remote component is in the **same webpack bundle** as the host — use `React.lazy` or a direct import.
- You need **full UI isolation** (separate CSS scope, separate document) — consider an `iframe`-based approach instead (planned for v0.2).
- Your MF framework is not React, or the remote does not use `createRoot` — the bridge assumes React 18+ on both sides.

---

## Known limitations

- **React 18+ required on both sides.** The bridge calls `createRoot` inside `createMFEntry`. React 17 and below are not supported.
- **Props are compared by reference.** The bridge sends a `propsChanged` event on every render where the `props` object reference changes. If you create a new object on every render (`props={{ a: 1 }}`), the remote re-renders on every host render. Stabilize with `useMemo` or move the object outside the component.
- **Fallback flicker on fast connections.** `MFBridgeLazy` shows the fallback until the module resolves. On fast connections the fallback may flash for a single frame. Wrap in `Suspense` at a higher level to coalesce loading states if needed.
- **SSR.** The bridge mounts in `useEffect`, which does not run on the server. The mount-point element renders empty on the server — plan your fallback and hydration accordingly.

---

## License

MIT
