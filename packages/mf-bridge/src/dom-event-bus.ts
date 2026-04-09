/**
 * Lightweight event bus backed by DOM CustomEvents on a specific element.
 *
 * Both the host and the MF get a reference to the same mount-point HTMLElement,
 * so events dispatched on it are visible to both sides without any shared
 * module state. The namespace prefix prevents collisions when multiple
 * microfrontends are mounted on the same page.
 */
export class DOMEventBus {
  constructor(
    private readonly element: HTMLElement,
    private readonly namespace: string,
  ) {}

  /** Dispatch an event carrying `detail` to all listeners on this element. */
  send<T>(event: string, detail: T): void {
    this.element.dispatchEvent(
      new CustomEvent(`${this.namespace}:${event}`, { detail, bubbles: false }),
    )
  }

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   * Call it in cleanup to avoid memory leaks.
   */
  on<T>(event: string, handler: (detail: T) => void): () => void {
    const key = `${this.namespace}:${event}`
    const listener = (e: Event) => handler((e as CustomEvent<T>).detail)
    this.element.addEventListener(key, listener)
    return () => this.element.removeEventListener(key, listener)
  }
}
