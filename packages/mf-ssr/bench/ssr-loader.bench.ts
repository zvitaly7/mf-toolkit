/**
 * @vitest-environment node
 *
 * End-to-end SSR throughput for loader-mode MFBridgeSSR.
 * Measures how long it takes to renderToReadableStream() a host tree
 * that contains N MFBridgeSSR fragments — each suspends on a Promise
 * that resolves to a small component, then the output is fully drained.
 *
 * This is the hot path for `renderToReadableStream` at the edge: bytes
 * out to the client. Lower number = faster time-to-first-byte.
 */
import { bench, describe } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { MFBridgeSSR } from '../src/host.js'

function Widget({ label }: { label: string }) {
  return createElement('span', null, label)
}

// Stable loader reference per N so the module-level lazyCache hits across
// iterations (real apps always have stable loader refs at module scope).
function makeLoaders(count: number): Array<() => Promise<ComponentType<{ label: string }>>> {
  return Array.from({ length: count }, () => () => Promise.resolve(Widget))
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read()
    if (done) return
  }
}

async function renderHost(count: number): Promise<void> {
  const loaders = makeLoaders(count)
  const fragments = loaders.map((loader, i) =>
    createElement(MFBridgeSSR<{ label: string }>, {
      key: i,
      loader,
      props: { label: `frag-${i}` },
      fallback: createElement('span', null, '…'),
    }),
  )
  const tree = createElement('div', null, ...fragments)
  const stream = await renderToReadableStream(tree)
  await stream.allReady
  await drain(stream)
}

describe('SSR loader-mode — 1 fragment', () => {
  bench('renderToReadableStream', async () => {
    await renderHost(1)
  })
})

describe('SSR loader-mode — 5 fragments', () => {
  bench('renderToReadableStream', async () => {
    await renderHost(5)
  })
})

describe('SSR loader-mode — 20 fragments', () => {
  bench('renderToReadableStream', async () => {
    await renderHost(20)
  })
})
