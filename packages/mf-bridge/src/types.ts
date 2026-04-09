/**
 * The function that `createMFEntry` returns on the remote (MF) side.
 * The host calls it once at mount time, passing the DOM element to render into
 * and the initial props. It returns an unmount callback.
 */
export type RegisterFn<P extends object = object> = (opts: {
  mountPointer: HTMLElement
  props: P
  /** Event namespace used by DOMEventBus. Must match the host's namespace. */
  namespace?: string
}) => () => void

/**
 * Extracts the props type from a synchronous `RegisterFn`.
 *
 * @example
 * const register: RegisterFn<{ orderId: string }> = ...
 * type Props = MFProps<typeof register> // { orderId: string }
 */
export type MFProps<T> = T extends RegisterFn<infer P> ? P : never

/**
 * Extracts the props type from a lazy loader `() => Promise<RegisterFn<P>>`.
 *
 * @example
 * const loader = () => import('./mf').then(m => m.register)
 * type Props = MFLazyProps<typeof loader> // inferred from register
 */
export type MFLazyProps<T> = T extends () => Promise<RegisterFn<infer P>> ? P : never
