import { createElement, type ComponentType } from 'react'
import { hydrateRoot } from 'react-dom/client'
import type { HydrateRemoteOpts } from './types.js'

export function hydrateRemote<P extends object>(
  Component: ComponentType<P>,
  opts?: HydrateRemoteOpts,
): void {
  if (typeof document === 'undefined') return

  const selector = opts?.selector
    ?? (opts?.id ? `[data-mf-ssr="${opts.id}"]` : '[data-mf-ssr]')

  const wrappers = document.querySelectorAll(selector)

  for (const wrapper of wrappers) {
    const propsEl = wrapper.querySelector('script[data-mf-props]')
    const appEl = wrapper.querySelector('[data-mf-app]')
    if (!appEl) continue

    let props: P = {} as P
    if (propsEl?.textContent) {
      try { props = JSON.parse(propsEl.textContent) } catch {}
    }

    hydrateRoot(appEl as HTMLElement, createElement(Component, props))
  }
}
