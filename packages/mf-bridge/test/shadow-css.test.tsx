/**
 * CSS isolation stress tests — multi-repo microfrontend simulation.
 *
 * Simulates a real setup where:
 *   • Host shell has Tailwind, a global design-system sheet, and CSS-in-JS output
 *   • Two independent MF remotes (checkout, header) each have their own styles
 *   • Remotes are built separately and loaded at runtime
 *
 * jsdom does not compute CSS, so tests verify:
 *   • Presence / absence of <style> elements in the correct DOM trees
 *   • Shadow root independence between multiple MFs
 *   • MutationObserver-based forwarding (dynamic injection)
 *   • That MF styles stay inside the shadow root and never reach document.head
 *
 * For computed-style assertions (actual color/layout) use Playwright/Cypress
 * against a real browser.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { createMFEntry } from '../src/entry.js'
import { MFBridge, MFBridgeLazy, forwardHostStyles } from '../src/host.js'

// ─── Simulated stylesheet content ────────────────────────────────────────────
// Each string represents what a real build tool would produce.

/** Host: Tailwind CDN or generated output */
const TAILWIND = '.flex{display:flex}.items-center{align-items:center}.text-blue-500{color:#3b82f6}.p-4{padding:1rem}'

/** Host: design-system global sheet (fonts, resets, color tokens) */
const DESIGN_SYSTEM = ':root{--brand:blue;--radius:4px}body{margin:0;font-family:sans-serif}'

/** Host: styled-components lazy output (injected when a SC component first renders) */
const SC_LAZY = '.sc-button.kDJQaE{background:#007bff;color:#fff;border-radius:4px}'

/** Host: Emotion CSS-in-JS output */
const EMOTION_LAZY = '.css-1a2b3c{font-size:14px;line-height:1.5}'

/** MF checkout: its own styles (must NOT leak to host) */
const CHECKOUT_STYLES = '.checkout-root{max-width:600px}.checkout-btn{background:#28a745}'

/** MF header: its own styles (must NOT leak, must NOT appear in checkout's shadow root) */
const HEADER_STYLES = '.header-root{height:64px}.header-logo{width:120px}'

// ─── Helper: inject a <style> into document.head ─────────────────────────────

function injectStyle(css: string, id: string): HTMLStyleElement {
  const el = document.createElement('style')
  el.setAttribute('data-testid', id)
  el.textContent = css
  document.head.appendChild(el)
  return el
}

function removeStyle(id: string) {
  document.head.querySelector(`[data-testid="${id}"]`)?.remove()
}

// ─── Simple remote components ─────────────────────────────────────────────────

function CheckoutWidget({ orderId }: { orderId: string }) {
  return createElement('div', { 'data-testid': 'checkout', className: 'checkout-root' }, `order:${orderId}`)
}

function HeaderWidget({ user }: { user: string }) {
  return createElement('div', { 'data-testid': 'header', className: 'header-root' }, `user:${user}`)
}

// ─── Remote registrations — simulates what each MF repo exports ───────────────

/** Checkout MF — injects its own styles into shadow root */
let checkoutCleanup: (() => void) | undefined
const checkoutRegister = createMFEntry(
  CheckoutWidget,
  ({ shadowRoot }) => {
    if (shadowRoot) {
      const sheet = document.createElement('style')
      sheet.setAttribute('data-mf', 'checkout')
      sheet.textContent = CHECKOUT_STYLES
      shadowRoot.appendChild(sheet)
    }
  },
  () => { checkoutCleanup?.() },
)

/** Header MF — injects its own styles into shadow root */
const headerRegister = createMFEntry(
  HeaderWidget,
  ({ shadowRoot }) => {
    if (shadowRoot) {
      const sheet = document.createElement('style')
      sheet.setAttribute('data-mf', 'header')
      sheet.textContent = HEADER_STYLES
      shadowRoot.appendChild(sheet)
    }
  },
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getShadow(slot: string): ShadowRoot | null | undefined {
  return document.querySelector<HTMLElement>(`[data-slot="${slot}"]`)?.shadowRoot
}

function stylesIn(root: ShadowRoot | Document | null | undefined): string[] {
  if (!root) return []
  return Array.from(root.querySelectorAll('style')).map((s) => s.textContent ?? '')
}

function hasStyle(root: ShadowRoot | Document | null | undefined, content: string): boolean {
  return stylesIn(root).some((s) => s.includes(content))
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('CSS isolation — multi-repo stress tests', () => {

  // ── 1. MF styles stay inside shadow root ────────────────────────────────────

  describe('MF styles do not leak to host', () => {
    afterEach(cleanup)

    it('checkout styles are only inside the checkout shadow root', async () => {
      await act(async () => {
        render(createElement(MFBridge, {
          register: checkoutRegister,
          props: { orderId: '42' },
          shadowDom: true,
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      const shadow = getShadow('checkout')
      // MF styles present inside shadow root
      expect(hasStyle(shadow, 'checkout-root')).toBe(true)
      // MF styles absent from document.head (the host's DOM)
      expect(hasStyle(document as any, 'checkout-root')).toBe(false)
    })

    it('header styles are only inside the header shadow root', async () => {
      await act(async () => {
        render(createElement(MFBridge, {
          register: headerRegister,
          props: { user: 'alice' },
          shadowDom: true,
          containerProps: { 'data-slot': 'header' } as any,
        }))
      })

      const shadow = getShadow('header')
      expect(hasStyle(shadow, 'header-root')).toBe(true)
      expect(hasStyle(document as any, 'header-root')).toBe(false)
    })
  })

  // ── 2. Host styles do not bleed in (no adoptHostStyles) ─────────────────────

  describe('host styles blocked from shadow root by default', () => {
    beforeEach(() => {
      injectStyle(TAILWIND, 'tailwind')
      injectStyle(DESIGN_SYSTEM, 'design-system')
    })
    afterEach(() => {
      removeStyle('tailwind')
      removeStyle('design-system')
      cleanup()
    })

    it('Tailwind is NOT present in the MF shadow root', async () => {
      await act(async () => {
        render(createElement(MFBridge, {
          register: checkoutRegister,
          props: { orderId: '1' },
          shadowDom: true,
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      const shadow = getShadow('checkout')
      expect(hasStyle(shadow, 'display:flex')).toBe(false)
      expect(hasStyle(shadow, 'text-blue-500')).toBe(false)
    })

    it('design-system global sheet is NOT present in the MF shadow root', async () => {
      await act(async () => {
        render(createElement(MFBridge, {
          register: checkoutRegister,
          props: { orderId: '2' },
          shadowDom: true,
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      const shadow = getShadow('checkout')
      expect(hasStyle(shadow, '--brand')).toBe(false)
    })
  })

  // ── 3. adoptHostStyles — host sheets flow into shadow root ───────────────────

  describe('adoptHostStyles forwards host sheets into shadow root', () => {
    beforeEach(() => {
      injectStyle(TAILWIND, 'tailwind')
      injectStyle(DESIGN_SYSTEM, 'design-system')
    })
    afterEach(() => {
      removeStyle('tailwind')
      removeStyle('design-system')
      cleanup()
    })

    it('Tailwind classes are available inside shadow root', async () => {
      await act(async () => {
        render(createElement(MFBridge, {
          register: checkoutRegister,
          props: { orderId: '3' },
          shadowDom: true,
          adoptHostStyles: true,
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      const shadow = getShadow('checkout')
      expect(hasStyle(shadow, 'display:flex')).toBe(true)
      expect(hasStyle(shadow, 'text-blue-500')).toBe(true)
    })

    it('design-system tokens are available inside shadow root', async () => {
      await act(async () => {
        render(createElement(MFBridge, {
          register: checkoutRegister,
          props: { orderId: '4' },
          shadowDom: true,
          adoptHostStyles: true,
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      const shadow = getShadow('checkout')
      expect(hasStyle(shadow, '--brand')).toBe(true)
    })

    it('MF own styles are still present alongside forwarded host styles', async () => {
      await act(async () => {
        render(createElement(MFBridge, {
          register: checkoutRegister,
          props: { orderId: '5' },
          shadowDom: true,
          adoptHostStyles: true,
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      const shadow = getShadow('checkout')
      // Both host and MF styles coexist in shadow root
      expect(hasStyle(shadow, 'display:flex')).toBe(true) // from Tailwind
      expect(hasStyle(shadow, 'checkout-root')).toBe(true)  // from MF
    })
  })

  // ── 4. Dynamic injection (CSS-in-JS simulation) ──────────────────────────────

  describe('dynamic CSS-in-JS injection is forwarded via MutationObserver', () => {
    afterEach(() => {
      removeStyle('sc-lazy')
      removeStyle('emotion-lazy')
      cleanup()
    })

    it('styled-components sheet injected after mount is forwarded to shadow root', async () => {
      await act(async () => {
        render(createElement(MFBridge, {
          register: checkoutRegister,
          props: { orderId: '6' },
          shadowDom: true,
          adoptHostStyles: true,
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      // Simulate styled-components lazily injecting a <style> for a new component
      injectStyle(SC_LAZY, 'sc-lazy')
      // Wait for MutationObserver microtask to fire
      await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)) })

      const shadow = getShadow('checkout')
      expect(hasStyle(shadow, 'sc-button')).toBe(true)
    })

    it('Emotion sheet injected after mount is forwarded to shadow root', async () => {
      await act(async () => {
        render(createElement(MFBridge, {
          register: checkoutRegister,
          props: { orderId: '7' },
          shadowDom: true,
          adoptHostStyles: true,
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      injectStyle(EMOTION_LAZY, 'emotion-lazy')
      await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)) })

      const shadow = getShadow('checkout')
      expect(hasStyle(shadow, 'css-1a2b3c')).toBe(true)
    })

    it('dynamic styles injected WITHOUT adoptHostStyles are NOT forwarded', async () => {
      await act(async () => {
        render(createElement(MFBridge, {
          register: checkoutRegister,
          props: { orderId: '8' },
          shadowDom: true,
          // adoptHostStyles NOT set
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      injectStyle(SC_LAZY, 'sc-lazy')
      await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)) })

      const shadow = getShadow('checkout')
      expect(hasStyle(shadow, 'sc-button')).toBe(false)
    })
  })

  // ── 5. Multiple MFs on the same page — full isolation ────────────────────────

  describe('multiple MFs on the same page are fully isolated', () => {
    beforeEach(() => {
      injectStyle(TAILWIND, 'tailwind')
    })
    afterEach(() => {
      removeStyle('tailwind')
      removeStyle('sc-lazy')
      cleanup()
    })

    it('each MF has its own independent shadow root', async () => {
      await act(async () => {
        render(
          createElement('div', null,
            createElement(MFBridge, {
              register: checkoutRegister,
              props: { orderId: '9' },
              shadowDom: true,
              containerProps: { 'data-slot': 'checkout' } as any,
            }),
            createElement(MFBridge, {
              register: headerRegister,
              props: { user: 'bob' },
              shadowDom: true,
              containerProps: { 'data-slot': 'header' } as any,
            }),
          ),
        )
      })

      const checkoutShadow = getShadow('checkout')
      const headerShadow = getShadow('header')

      expect(checkoutShadow).not.toBe(headerShadow)
      expect(checkoutShadow).toBeInstanceOf(ShadowRoot)
      expect(headerShadow).toBeInstanceOf(ShadowRoot)
    })

    it('checkout styles are NOT present in header shadow root', async () => {
      await act(async () => {
        render(
          createElement('div', null,
            createElement(MFBridge, {
              register: checkoutRegister,
              props: { orderId: '10' },
              shadowDom: true,
              containerProps: { 'data-slot': 'checkout' } as any,
            }),
            createElement(MFBridge, {
              register: headerRegister,
              props: { user: 'carol' },
              shadowDom: true,
              containerProps: { 'data-slot': 'header' } as any,
            }),
          ),
        )
      })

      expect(hasStyle(getShadow('header'), 'checkout-root')).toBe(false)
      expect(hasStyle(getShadow('checkout'), 'header-root')).toBe(false)
    })

    it('adoptHostStyles on checkout does NOT inject into header shadow root', async () => {
      await act(async () => {
        render(
          createElement('div', null,
            createElement(MFBridge, {
              register: checkoutRegister,
              props: { orderId: '11' },
              shadowDom: true,
              adoptHostStyles: true,  // only checkout opts in
              containerProps: { 'data-slot': 'checkout' } as any,
            }),
            createElement(MFBridge, {
              register: headerRegister,
              props: { user: 'dan' },
              shadowDom: true,
              // header does NOT use adoptHostStyles
              containerProps: { 'data-slot': 'header' } as any,
            }),
          ),
        )
      })

      // Checkout has Tailwind, header does not
      expect(hasStyle(getShadow('checkout'), 'display:flex')).toBe(true)
      expect(hasStyle(getShadow('header'), 'display:flex')).toBe(false)
    })

    it('dynamic injection is forwarded to ALL MFs that opted in', async () => {
      await act(async () => {
        render(
          createElement('div', null,
            createElement(MFBridge, {
              register: checkoutRegister,
              props: { orderId: '12' },
              shadowDom: true,
              adoptHostStyles: true,
              containerProps: { 'data-slot': 'checkout' } as any,
            }),
            createElement(MFBridge, {
              register: headerRegister,
              props: { user: 'eve' },
              shadowDom: true,
              adoptHostStyles: true,
              containerProps: { 'data-slot': 'header' } as any,
            }),
          ),
        )
      })

      injectStyle(SC_LAZY, 'sc-lazy')
      await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)) })

      // Both MFs receive the new style
      expect(hasStyle(getShadow('checkout'), 'sc-button')).toBe(true)
      expect(hasStyle(getShadow('header'), 'sc-button')).toBe(true)
    })

    it('unmounting one MF does not affect the other', async () => {
      const { rerender } = await act(async () =>
        render(
          createElement('div', null,
            createElement(MFBridge, {
              register: checkoutRegister,
              props: { orderId: '13' },
              shadowDom: true,
              containerProps: { 'data-slot': 'checkout' } as any,
            }),
            createElement(MFBridge, {
              register: headerRegister,
              props: { user: 'frank' },
              shadowDom: true,
              containerProps: { 'data-slot': 'header' } as any,
            }),
          ),
        ),
      )

      // Unmount checkout by removing it from the tree
      await act(async () => {
        rerender(
          createElement('div', null,
            createElement(MFBridge, {
              register: headerRegister,
              props: { user: 'frank' },
              shadowDom: true,
              containerProps: { 'data-slot': 'header' } as any,
            }),
          ),
        )
      })

      // Header MF still renders correctly
      const headerShadow = getShadow('header')
      expect(headerShadow?.querySelector('[data-testid="header"]')?.textContent).toBe('user:frank')
    })
  })

  // ── 6. forwardHostStyles utility — manual usage in onBeforeMount ─────────────

  describe('forwardHostStyles used manually in createMFEntry (remote-side control)', () => {
    afterEach(() => {
      removeStyle('manual-style')
      removeStyle('late-style')
      cleanup()
    })

    it('remote injects host styles manually and they appear in shadow root', async () => {
      injectStyle(DESIGN_SYSTEM, 'manual-style')

      let stopFwd: (() => void) | undefined
      const register = createMFEntry(
        CheckoutWidget,
        ({ shadowRoot }) => {
          if (shadowRoot) stopFwd = forwardHostStyles(shadowRoot)
        },
        () => { stopFwd?.() },
      )

      await act(async () => {
        render(createElement(MFBridge, {
          register,
          props: { orderId: '14' },
          shadowDom: true,
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      const shadow = getShadow('checkout')
      expect(hasStyle(shadow, '--brand')).toBe(true)
    })

    it('MutationObserver set up by remote picks up styles injected after mount', async () => {
      let stopFwd: (() => void) | undefined
      const register = createMFEntry(
        CheckoutWidget,
        ({ shadowRoot }) => {
          if (shadowRoot) stopFwd = forwardHostStyles(shadowRoot)
        },
        () => { stopFwd?.() },
      )

      await act(async () => {
        render(createElement(MFBridge, {
          register,
          props: { orderId: '15' },
          shadowDom: true,
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      // Simulate host injecting a new stylesheet after mount
      injectStyle(TAILWIND, 'late-style')
      await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)) })

      expect(hasStyle(getShadow('checkout'), 'display:flex')).toBe(true)
    })
  })

  // ── 7. Lazy loading (MFBridgeLazy) with CSS isolation ─────────────────────────

  describe('MFBridgeLazy + shadowDom', () => {
    beforeEach(() => {
      injectStyle(TAILWIND, 'tailwind')
    })
    afterEach(() => {
      removeStyle('tailwind')
      cleanup()
    })

    it('shadow root is created and isolated after async load', async () => {
      const loader = () => Promise.resolve(checkoutRegister)

      await act(async () => {
        render(createElement(MFBridgeLazy, {
          register: loader,
          props: { orderId: '16' },
          shadowDom: true,
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      const shadow = getShadow('checkout')
      expect(shadow).toBeInstanceOf(ShadowRoot)
      // Host Tailwind NOT inside (no adoptHostStyles)
      expect(hasStyle(shadow, 'display:flex')).toBe(false)
      // MF styles ARE inside
      expect(hasStyle(shadow, 'checkout-root')).toBe(true)
    })

    it('adoptHostStyles on MFBridgeLazy forwards sheets after load', async () => {
      const loader = () => Promise.resolve(checkoutRegister)

      await act(async () => {
        render(createElement(MFBridgeLazy, {
          register: loader,
          props: { orderId: '17' },
          shadowDom: true,
          adoptHostStyles: true,
          containerProps: { 'data-slot': 'checkout' } as any,
        }))
      })

      const shadow = getShadow('checkout')
      expect(hasStyle(shadow, 'display:flex')).toBe(true)
      expect(hasStyle(shadow, 'checkout-root')).toBe(true)
    })
  })
})
