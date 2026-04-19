# `@mf-toolkit/mf-bridge`

[![npm version](https://img.shields.io/npm/v/@mf-toolkit/mf-bridge?color=CB3837&logo=npm)](https://www.npmjs.com/package/@mf-toolkit/mf-bridge)
[![license](https://img.shields.io/npm/l/@mf-toolkit/mf-bridge?color=blue)](https://github.com/zvitaly7/mf-toolkit/blob/main/LICENSE)
[![react](https://img.shields.io/badge/react-18%20%7C%2019%20%7C%2020-61DAFB?logo=react)](https://react.dev)

**Mount microfrontend components from any Module Federation remote — lazy loading, automatic prop streaming, bidirectional events, CSS isolation via Shadow DOM, and framework-agnostic remote support.**

`mf-bridge` replaces the copy-paste `moved_to_mf_*` wrapper pattern. Define once how a remote component should be mounted, and the bridge handles the full lifecycle: lazy load → mount in a dedicated DOM node → stream prop updates via DOM events → emit events back to the host → clean unmount.

Remote can be **React, Vue, Angular, Svelte, or vanilla JS** — the host side is always the same two components.

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
| **Remote→Host events** without shared globals | ✗ | ✗ | ✅ |
| **Host→Remote commands** (`commandRef`) | ✗ | ✗ | ✅ |
| **Load status tracking** (`onStatusChange`) | ✗ | ✗ | ✅ |
| **Retry** on transient failure (auto + manual) | ✗ | ✗ | ✅ |
| **Timeout** per load attempt | ✗ | ✗ | ✅ |
| **CSS isolation** via Shadow DOM | ✗ | ✗ | ✅ |
| **Framework-agnostic** remote (Vue, Angular, vanilla) | ✗ | ✗ | ✅ |
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

## DI — setup and teardown

Use `onBeforeMount` and `onBeforeUnmount` in `createMFEntry` to bracket your DI container around the component's lifetime:

```tsx
// checkout-mf/src/entry.ts
import { createMFEntry } from '@mf-toolkit/mf-bridge/entry'
import { CheckoutWidget } from './CheckoutWidget'
import { container } from './di'

export const register = createMFEntry(
  CheckoutWidget,
  ({ props }) => {
    // Called once, before createRoot. Safe to read initial props here.
    container.set('apiClient', props.apiClient)
    container.set('user', props.user)
  },
  () => {
    // Called just before root.unmount(). Clean up DI registrations.
    container.reset()
  },
)
```

Both callbacks receive `{ mountPointer }`. `onBeforeMount` also receives `props`, `namespace`, and an `emit` function to push events to the host (see [Remote→Host events](#remoteto-host-events)).

---

## Error containment

When the remote component throws during render, the bridge isolates the crash: the mount point renders `null` instead of broken UI, and the host is notified via `onError`:

```tsx
// checkout-mf/src/entry.ts
export const register = createMFEntry(
  CheckoutWidget,
  undefined,
  undefined,
  (err) => {
    logger.error('CheckoutWidget crashed', err)
    analytics.track('mf_render_error', { remote: 'checkout' })
  },
)
```

The error boundary **resets automatically** on the next `propsChanged` event, so a recovered component re-renders cleanly when new props arrive — no manual reset needed.

---

## Remote→Host events

Remote components can push events back to the host shell — without shared module state. Use `emit` inside `createMFEntry` and `onEvent` on the host side.

**Remote side** — call `emit(type, payload?)` from `onBeforeMount` or pass it into the component:

```tsx
// checkout-mf/src/entry.ts
export const register = createMFEntry(
  CheckoutWidget,
  ({ emit }) => {
    // Give the component a way to notify the host
    CheckoutWidget.onOrderPlaced = (orderId: string) =>
      emit('orderPlaced', { orderId })
  },
)
```

**Host side** — handle events via `onEvent`:

```tsx
<MFBridgeLazy
  register={() => import('checkout/entry').then(m => m.register)}
  props={{ orderId }}
  onEvent={(type, payload) => {
    if (type === 'orderPlaced') navigate('/confirmation')
    if (type === 'cancelled')  navigate('/cart')
  }}
  fallback={<Spinner />}
/>
```

Events travel over the same DOM `CustomEvent` channel as prop streaming — no shared globals, no React context crossing bundle boundaries.

`onEvent` is also available on the synchronous `MFBridge` component.

---

## Host→Remote commands

The host can dispatch imperative commands to the remote at any time via `commandRef`. Common use cases: reset a form, scroll to top, trigger a focus.

**Host side:**

```tsx
const cmdRef = useRef<(type: string, payload?: unknown) => void>(null)

<MFBridgeLazy
  register={checkoutLoader}
  props={{ orderId }}
  commandRef={cmdRef}
/>

// Somewhere else in the host:
cmdRef.current?.('reset', { keepEmail: true })
```

**Remote side** — subscribe in `onBeforeMount`:

```tsx
export const register = createMFEntry(
  CheckoutWidget,
  ({ onCommand }) => {
    onCommand((type, payload) => {
      if (type === 'reset') CheckoutWidget.reset(payload)
      if (type === 'focus') inputRef.current?.focus()
    })
  },
)
```

Subscriptions are cleaned up automatically on unmount even if you never call the returned unsubscribe function.

---

## CSS isolation via Shadow DOM

Mount the remote inside a Shadow DOM so host styles cannot bleed in and remote styles cannot bleed out.

```tsx
<MFBridgeLazy
  register={checkoutLoader}
  props={{ orderId }}
  shadowDom
/>
```

The shadow root (mode `"open"`) is passed to `createMFEntry`'s `onBeforeMount`, so the remote can inject its own styles:

```tsx
export const register = createMFEntry(
  CheckoutWidget,
  ({ shadowRoot }) => {
    if (shadowRoot) {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(checkoutStyles)
      shadowRoot.adoptedStyleSheets = [sheet]
    }
  },
)
```

**Forwarding host styles into the shadow root**

By default, host stylesheets (Tailwind, design system, CSS-in-JS) are not visible inside the shadow root. Use `adoptHostStyles` to forward them automatically — including sheets injected dynamically after mount:

```tsx
<MFBridgeLazy
  register={checkoutLoader}
  props={{ orderId }}
  shadowDom
  adoptHostStyles   // clones <style>/<link> from document.head + MutationObserver
/>
```

For manual control in the remote, use the exported `forwardHostStyles` utility:

```tsx
import { forwardHostStyles } from '@mf-toolkit/mf-bridge'

let stop: (() => void) | undefined
export const register = createMFEntry(
  CheckoutWidget,
  ({ shadowRoot }) => {
    if (shadowRoot) stop = forwardHostStyles(shadowRoot)
  },
  () => { stop?.() },
)
```

CSS custom properties (CSS variables) inherit through shadow DOM natively — no forwarding needed.

---

## Framework-agnostic remotes

Use `defineMFEntry` when the remote is built with Vue, Angular, Svelte, or vanilla JS. The host side (`MFBridge` / `MFBridgeLazy`) does not change.

**Import:** `@mf-toolkit/mf-bridge/define-entry`

```tsx
import { defineMFEntry } from '@mf-toolkit/mf-bridge/define-entry'

// Vue 3 remote
export const register = defineMFEntry({
  mount({ mountPointer, props }) {
    const app = createApp(MyWidget, props)
    app.mount(mountPointer)
    return app
  },
  update(app, props) {
    // Update reactive state, or unmount+remount if needed
    app.config.globalProperties.$props = props
  },
  unmount(app) {
    app.unmount()
  },
})
```

```tsx
// Vanilla JS remote with events and commands
export const register = defineMFEntry({
  mount({ mountPointer, props, emit, onCommand }) {
    const el = document.createElement('div')
    el.textContent = props.label
    el.addEventListener('click', () => emit('clicked'))
    onCommand((type) => { if (type === 'reset') { el.textContent = '' } })
    mountPointer.appendChild(el)
    return el
  },
  update(el, props) { el.textContent = props.label },
  unmount(el, mountPointer) { mountPointer.removeChild(el) },
})
```

`mount` receives the same opts as `createMFEntry`'s `onBeforeMount` — `mountPointer`, `shadowRoot`, `props`, `namespace`, `emit`, `onCommand`. It returns an opaque instance value forwarded to `update` and `unmount`.

The host mounts it identically:

```tsx
<MFBridgeLazy
  register={() => import('vue-checkout/entry').then(m => m.register)}
  props={{ orderId }}
  fallback={<Spinner />}
/>
```

---

## Preloading for instant mount

Call `preloadMF` as early as possible (on hover, on route prefetch, on app init) to start loading the remote bundle before the component renders. `MFBridgeLazy` reuses the already-started promise — no duplicate network request.

```tsx
import { preloadMF } from '@mf-toolkit/mf-bridge'

const checkoutLoader = () => import('checkout/entry').then(m => m.register)

// Start loading on hover — before the user clicks
<button onMouseEnter={() => preloadMF(checkoutLoader)}>
  Checkout
</button>

// Later, when the component actually renders, the module is already loaded
<MFBridgeLazy register={checkoutLoader} props={{ orderId }} fallback={<Spinner />} />
```

> **Note:** `preloadMF` uses the loader function reference as the cache key. Define the loader outside your component (or wrap with `useCallback`) so the reference is stable.

To evict an entry from the cache (e.g. after a deploy or on user logout), use `clearPreloadCache`:

```tsx
import { clearPreloadCache } from '@mf-toolkit/mf-bridge'

// Evict one remote — next preloadMF/render makes a fresh request
clearPreloadCache(checkoutLoader)

// Wipe all cached remotes at once
clearPreloadCache()
```

---

## Retry on load failure

Use `retryCount` and `retryDelay` to automatically retry a failed load — useful for transient CDN errors or flaky network conditions:

```tsx
<MFBridgeLazy
  register={() => import('checkout/entry').then(m => m.register)}
  props={{ orderId }}
  fallback={<Spinner />}
  retryCount={3}        // up to 3 additional attempts after the first failure
  retryDelay={1000}     // wait 1 s between each retry
  onError={(err, retry) => {
    logger.error('checkout failed to load', err)
    showToast('Failed to load module', { action: retry })
  }}
/>
```

Each automatic retry bypasses the preload cache and calls the factory again with a fresh network request. When all attempts are exhausted, `onError` is called once with the error **and a `retry` callback** — call it to trigger an additional manual load attempt (also bypasses cache):

```tsx
onError={(err, retry) => {
  // Show a "Try again" button — clicking it calls retry()
  setErrorState({ err, onRetry: retry })
}}
```

The component stays on `fallback` until the manual retry succeeds.

---

## Load timeout

Use `timeout` to set a per-attempt time limit. If a single load attempt doesn't resolve within the window, it's treated as a failure and the retry pipeline kicks in:

```tsx
<MFBridgeLazy
  register={() => import('checkout/entry').then(m => m.register)}
  props={{ orderId }}
  timeout={5000}      // fail the attempt after 5 s
  retryCount={2}      // then retry up to 2 more times
  retryDelay={1000}
  onError={(err, retry) => showRetryToast(retry)}
  fallback={<Spinner />}
/>
```

`timeout` is per-attempt — each retry gets a fresh window.

---

## Load status tracking

`onStatusChange` gives a single callback that tracks all load state transitions in one place — useful for analytics, Redux, or a global loading indicator:

```tsx
<MFBridgeLazy
  register={() => import('checkout/entry').then(m => m.register)}
  props={{ orderId }}
  onStatusChange={(status) => {
    // 'loading' → 'ready'     on success
    // 'loading' → 'error'     after all retries fail
    // 'loading' → 'ready'     again after manual retry succeeds
    dispatch({ type: 'MF_STATUS', remote: 'checkout', status })
  }}
  fallback={<Spinner />}
/>
```

| Status | When |
|---|---|
| `'loading'` | At the start of every attempt cycle (initial load and each manual retry) |
| `'ready'` | Module resolved and remote component mounted |
| `'error'` | All attempts (including auto-retries) exhausted |

---

## Debug mode

Add `debug` to any bridge instance to get `console.debug` logs for every lifecycle event:

```tsx
<MFBridgeLazy
  register={checkoutLoader}
  props={{ orderId }}
  debug={process.env.NODE_ENV === 'development'}
/>
```

`MFBridge` logs: `mount`, `propsChanged`, `unmount`
`MFBridgeLazy` logs: `load:start`, `load:retry`, `load:ok`, `load:error`

All log lines are prefixed with `[mf-bridge:<namespace>]` for easy filtering in DevTools. The flag is `false` by default — zero cost in production.

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

Each `MFBridge` / `MFBridgeLazy` instance gets a **unique auto-generated namespace** (e.g. `mfbridge-1`, `mfbridge-2`) when the `namespace` prop is omitted. This means debug logs clearly distinguish concurrent instances of the same MF, and there is no configuration needed when mounting the same remote multiple times.

Events are always element-scoped (non-bubbling `CustomEvent`s on the specific mount-point element), so two instances cannot hear each other's events regardless of namespace.

If you need an explicit namespace (e.g. for integration with other event systems or for predictable debug prefixes), set it via the prop:

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

### `createMFEntry(Component, onBeforeMount?, onBeforeUnmount?, onError?)` — React remote side

**Import:** `@mf-toolkit/mf-bridge/entry`

```typescript
function createMFEntry<T extends ComponentType<any>>(
  Component: T,
  onBeforeMount?: (opts: {
    mountPointer: HTMLElement
    props: ComponentProps<T>
    namespace: string
    shadowRoot: ShadowRoot | undefined
    emit: (type: string, payload?: unknown) => void
    onCommand: (handler: (type: string, payload: unknown) => void) => () => void
  }) => void,
  onBeforeUnmount?: (opts: { mountPointer: HTMLElement }) => void,
  onError?: (err: Error) => void,
): RegisterFn<ComponentProps<T>>
```

| Parameter | Type | Description |
|---|---|---|
| `Component` | `ComponentType<P>` | React component to expose to the host |
| `onBeforeMount` | `(opts) => void` | Called once before `createRoot`. Use for DI setup, style injection, and event wiring. |
| `onBeforeMount opts.namespace` | `string` | The CustomEvent namespace in use. |
| `onBeforeMount opts.shadowRoot` | `ShadowRoot \| undefined` | Provided when host enables `shadowDom`. Use to inject component styles. |
| `onBeforeMount opts.emit` | `(type, payload?) => void` | Sends a custom event to the host via `onEvent`. |
| `onBeforeMount opts.onCommand` | `(handler) => () => void` | Subscribes to commands from the host via `commandRef`. Auto-cleaned on unmount. |
| `onBeforeUnmount` | `(opts) => void` | Called just before `root.unmount()`. |
| `onError` | `(err: Error) => void` | Called when the component throws. Renders `null`; boundary resets on next `propsChanged`. |

Returns a `RegisterFn<P>` — a function the host calls at mount time.

---

### `defineMFEntry(config)` — framework-agnostic remote side

**Import:** `@mf-toolkit/mf-bridge/define-entry`

```typescript
function defineMFEntry<P extends object = object, I = unknown>(config: {
  mount: (opts: MFMountOpts<P>) => I
  update?: (instance: I, props: P) => void
  unmount: (instance: I, mountPointer: HTMLElement) => void
}): RegisterFn<P>
```

| Config key | Type | Description |
|---|---|---|
| `mount` | `(opts) => I` | Called on mount. `opts` is identical to `createMFEntry`'s `onBeforeMount` opts. Returns an opaque instance forwarded to `update` and `unmount`. |
| `update` | `(instance, props) => void` | Called when the host streams new props. Omit if your framework handles reactivity internally. |
| `unmount` | `(instance, mountPointer) => void` | Teardown — destroy the app, remove DOM nodes, cancel subscriptions. |

Returns a `RegisterFn<P>` compatible with `MFBridge` and `MFBridgeLazy`.

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

| Prop | Type | Default | Description |
|---|---|---|---|
| `register` | `() => Promise<RegisterFn<P>>` | — | Async factory. Re-evaluated when reference changes. Pre-warm with `preloadMF`. |
| `props` | `MFLazyProps<typeof register>` | — | Props forwarded to the remote component. Inferred from `register`. |
| `fallback` | `ReactNode` | `null` | Rendered while loading. |
| `errorFallback` | `ReactNode` | — | Rendered when all load attempts fail. Falls back to `fallback` if omitted. |
| `tagName` | `string` | `'mf-bridge'` | HTML tag for the mount-point element. |
| `namespace` | `string` | auto | CustomEvent namespace. Auto-generated unique value per instance if omitted. |
| `onLoad` | `() => void` | — | Called once the remote module resolves successfully. |
| `onError` | `(err, retry) => void` | — | Called after all retries fail. Second arg triggers a manual retry. |
| `onStatusChange` | `(status) => void` | — | `'loading'` → `'ready'` or `'error'` on every transition. |
| `onEvent` | `(type, payload) => void` | — | Called when the remote emits a custom event via `emit()`. |
| `commandRef` | `{ current: fn \| null }` | — | Populated with a `send(type, payload?)` function after mount. |
| `mountRef` | `{ current: HTMLElement \| null }` | — | Populated with the mount-point element after mount. |
| `containerProps` | `HTMLAttributes` | — | HTML attributes forwarded to the mount-point element (`id`, `style`, `data-*`, etc.). |
| `debug` | `boolean` | `false` | Enable `console.debug` lifecycle logging. |
| `retryCount` | `number` | `0` | Additional automatic load attempts after the first failure. |
| `retryDelay` | `number` | `0` | Milliseconds between automatic retries. |
| `timeout` | `number` | — | Per-attempt timeout in ms. |
| `shadowDom` | `boolean` | `false` | Render inside a Shadow DOM for CSS isolation. |
| `adoptHostStyles` | `boolean` | `false` | Forward host `<style>`/`<link>` into the shadow root (requires `shadowDom`). |

---

### `<MFBridge>` — host side, sync

**Import:** `@mf-toolkit/mf-bridge`

| Prop | Type | Default | Description |
|---|---|---|---|
| `register` | `RegisterFn<P>` | — | Synchronous register function from the remote. |
| `props` | `MFProps<typeof register>` | — | Props forwarded to the remote component. Inferred from `register`. |
| `tagName` | `string` | `'mf-bridge'` | HTML tag used as the mount-point element. |
| `namespace` | `string` | auto | CustomEvent namespace. Auto-generated unique value per instance if omitted. |
| `debug` | `boolean` | `false` | Enable `console.debug` logging (`mount`, `propsChanged`, `unmount`). |
| `onEvent` | `(type, payload) => void` | — | Called when the remote emits a custom event via `emit()`. |
| `commandRef` | `{ current: fn \| null }` | — | Populated with a `send(type, payload?)` function after mount. |
| `mountRef` | `{ current: HTMLElement \| null }` | — | Populated with the mount-point element after mount. |
| `containerProps` | `HTMLAttributes` | — | HTML attributes forwarded to the mount-point element. |
| `shadowDom` | `boolean` | `false` | Render inside a Shadow DOM for CSS isolation. |
| `adoptHostStyles` | `boolean` | `false` | Forward host stylesheets into the shadow root (requires `shadowDom`). |

---

### `preloadMF(loader)` — prefetch utility

**Import:** `@mf-toolkit/mf-bridge`

```typescript
function preloadMF<T extends RegisterFn<any>>(loader: () => Promise<T>): void
```

Starts loading a remote module before `MFBridgeLazy` renders. Uses the loader reference as the cache key — `MFBridgeLazy` with the same reference reuses the in-flight promise. Calling `preloadMF` multiple times with the same reference is safe (no-op after the first call).

---

### `clearPreloadCache(loader?)` — cache eviction

**Import:** `@mf-toolkit/mf-bridge`

```typescript
function clearPreloadCache(loader?: () => Promise<RegisterFn<any>>): void
```

Removes one or all entries from the preload cache.

| Argument | Behaviour |
|---|---|
| `clearPreloadCache(loader)` | Evicts one entry. Next `preloadMF`/`MFBridgeLazy` render makes a fresh request. |
| `clearPreloadCache()` | Clears the entire cache. |

Typical use cases: force re-fetch after a deploy, clear on user logout, reset between tests.

---

### `MFBridgeStatus` — load status type

```typescript
type MFBridgeStatus = 'loading' | 'ready' | 'error'
```

The value passed to `onStatusChange`. Exported for use in typed state slices or analytics schemas.

---

### Utility types

```typescript
// Extracts props type from a synchronous RegisterFn
type MFProps<T> = T extends RegisterFn<infer P> ? P : never

// Extracts props type from a lazy loader () => Promise<RegisterFn<P>>
type MFLazyProps<T> = T extends () => Promise<RegisterFn<infer P>> ? P : never
```

---

### `forwardHostStyles(shadowRoot)` — style forwarding utility

**Import:** `@mf-toolkit/mf-bridge`

```typescript
function forwardHostStyles(shadowRoot: ShadowRoot): () => void
```

Clones existing `<style>` and `<link rel="stylesheet">` elements from `document.head` into the shadow root, shares `document.adoptedStyleSheets`, and attaches a `MutationObserver` that forwards any stylesheets injected after mount (lazy CSS-in-JS, Tailwind CDN).

Returns a cleanup function — call it in `onBeforeUnmount` or let `adoptHostStyles` handle it automatically.

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

## Production and polyrepo setup

### Separation of concerns

`mf-bridge` handles **mounting**: it receives a `register` function and manages the full React lifecycle — `createRoot`, prop streaming, cleanup.

It deliberately does **not** handle how remotes are located or loaded. That separation keeps the bridge compatible with any Module Federation setup: static webpack remotes, dynamic URL resolution, runtime federation, or a custom loader.

```
┌──────────────────────────────────────────────────────────────┐
│  Where is remoteEntry.js?  → webpack config / mf-loader      │
│  Has this remote been loaded before? → mf-loader registry    │
│  Type-safe importRemote?   → mf-loader                       │
├──────────────────────────────────────────────────────────────┤
│  Mount register() into DOM → mf-bridge  ✓                    │
│  Stream prop updates       → mf-bridge  ✓                    │
│  Show fallback while loading → mf-bridge  ✓                  │
└──────────────────────────────────────────────────────────────┘
```

### How `import('checkout/entry')` works at runtime

The dynamic import inside the `register` factory is not a regular import — webpack intercepts it. When the host's `ModuleFederationPlugin` declares a remote:

```js
remotes: { checkout: 'checkout@https://cdn.example.com/remoteEntry.js' }
```

webpack records that mapping at build time. At runtime, the first `import('checkout/entry')` triggers:

1. Inject `<script src="https://cdn.example.com/remoteEntry.js">` into the page.
2. Initialize the `checkout` scope (shared dependency negotiation).
3. Fetch and evaluate the chunk containing the `./entry` module.
4. Resolve the promise with `{ register, … }`.

By the time `MFBridgeLazy` receives the resolved `register` function, all of that is already done. The bridge only sees the result.

### Static remotes (monorepo or fixed URLs)

The simplest production setup: each remote has a stable CDN URL, declared in the host's webpack config.

```js
// host/webpack.config.js
new ModuleFederationPlugin({
  name: 'host',
  remotes: {
    checkout: `checkout@${process.env.CHECKOUT_URL ?? 'https://cdn.example.com/checkout/remoteEntry.js'}`,
    catalog:  `catalog@${process.env.CATALOG_URL  ?? 'https://cdn.example.com/catalog/remoteEntry.js'}`,
  },
  shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
})
```

The host app is rebuilt (or the env var is updated) whenever a remote ships a new version. `mf-bridge` usage is unchanged:

```tsx
<MFBridgeLazy
  register={() => import('checkout/entry').then(m => m.register)}
  props={{ orderId }}
  fallback={<Spinner />}
/>
```

### Dynamic remotes (URL from experiment/feature flag)

When the remote URL is only known at runtime — from an A/B experiment config, a feature flag service, or a version API — use Module Federation's `loadRemote` to bootstrap the scope before importing:

```tsx
import { loadRemote } from '@module-federation/enhanced/runtime'

async function getCheckoutRegister() {
  const url = await featureFlags.get('checkout_remote_url')
  // Load and initialize the remote scope at runtime
  await loadRemote({ url, scope: 'checkout' })
  const m = await import('checkout/entry')
  return m.register
}

<MFBridgeLazy
  register={getCheckoutRegister}
  props={{ orderId }}
  fallback={<Spinner />}
/>
```

The `register` prop accepts any `() => Promise<RegisterFn>` — the bridge doesn't care how the module is fetched.

### Polyrepo CI/CD flow

Each microfrontend lives in its own repository with its own build and deploy pipeline:

```
checkout-mf repo ──→ CI build ──→ upload to CDN
                                  s3://cdn/checkout/{version}/remoteEntry.js
                                  s3://cdn/checkout/latest/remoteEntry.js

catalog-mf repo  ──→ CI build ──→ upload to CDN
                                  s3://cdn/catalog/{version}/remoteEntry.js

host repo ────────→ CI build ──→ bundle with CHECKOUT_URL / CATALOG_URL
                                  (injected from env at build or runtime)
```

The `register` function exported from `checkout/entry` is just a JavaScript value — versioned and shipped with the remote bundle. `mf-bridge` receives it after Module Federation has done the network work.

### Development with local remotes

Point the host at locally running MF dev servers via env vars:

```bash
# .env.development (host repo)
CHECKOUT_URL=http://localhost:3001/remoteEntry.js
CATALOG_URL=http://localhost:3002/remoteEntry.js
```

```js
// host/webpack.config.js
remotes: {
  checkout: `checkout@${process.env.CHECKOUT_URL}`,
}
```

No changes to `mf-bridge` usage — `import('checkout/entry')` resolves from the local dev server instead of the CDN.

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
    checkout: `checkout@${process.env.CHECKOUT_URL ?? 'https://cdn.example.com/checkout/remoteEntry.js'}`,
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

## Planned / out of scope

| Feature | Status |
|---|---|
| Remote module registry / caching | Separate package: `@mf-toolkit/mf-loader` |
| Type-safe `importRemote` wrapper | Separate package: `@mf-toolkit/mf-loader` |
| URL resolution / DEV port scanning | Separate package: `@mf-toolkit/mf-loader` |
| Remote→Host events (`emit` / `onEvent`) | ✅ Shipped in v0.2 |
| Host→Remote commands (`commandRef` / `onCommand`) | ✅ Shipped in v0.2 |
| Load status tracking (`onStatusChange`) | ✅ Shipped in v0.2 |
| Manual retry callback in `onError` | ✅ Shipped in v0.2 |
| Per-attempt load `timeout` | ✅ Shipped in v0.2 |
| CSS isolation via Shadow DOM (`shadowDom`, `adoptHostStyles`) | ✅ Shipped in v0.3 |
| Framework-agnostic remotes (`defineMFEntry`) | ✅ Shipped in v0.3 |
| `iframe` transport mode | Planned — hard UI isolation with a separate document |

---

## When not to use this package

- Your remote component is in the **same webpack bundle** as the host — use `React.lazy` or a direct import.
- You need **full UI isolation with a separate document** — consider an `iframe`-based approach.

---

## Known limitations

- **React 18+ required on the host side.** `MFBridge` and `MFBridgeLazy` are React components. The remote can be any framework via `defineMFEntry`.
- **`createMFEntry` requires React 18+ on the remote side.** Use `defineMFEntry` for non-React remotes.
- **Props are compared by reference.** The bridge sends a `propsChanged` event on every render where the `props` object reference changes. Stabilize with `useMemo` or move the object outside the component.
- **Fallback flicker on fast connections.** `MFBridgeLazy` shows the fallback until the module resolves. On fast connections the fallback may flash for a single frame.
- **SSR.** The bridge mounts in `useEffect`, which does not run on the server. The mount-point element renders empty on the server — plan your fallback and hydration accordingly. If `RegisterFn` is somehow called in a non-DOM environment, it returns a no-op instead of crashing.

---

## License

MIT
