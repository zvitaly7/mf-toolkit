import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      ['**/hydrate.test.ts', 'jsdom'],
      ['**/host.test.ts', 'jsdom'],
    ],
  },
  resolve: {
    // Use the Web Streams build so renderToReadableStream is available in Node 18+
    alias: {
      'react-dom/server': 'react-dom/server.browser',
    },
  },
})
