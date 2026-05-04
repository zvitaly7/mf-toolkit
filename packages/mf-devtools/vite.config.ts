import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config.js'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        devtools: 'src/devtools/devtools.html',
        panel: 'src/panel/panel.html',
      },
    },
  },
  legacy: {
    skipWebSocketTokenCheck: true,
  },
})
