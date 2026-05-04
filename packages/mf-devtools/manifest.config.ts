import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  name: 'MF DevTools',
  version: pkg.version,
  description: pkg.description,
  minimum_chrome_version: '111',
  devtools_page: 'src/devtools/devtools.html',
  background: {
    service_worker: 'src/background/background.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/hook-installer.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    },
    {
      matches: ['<all_urls>'],
      js: ['src/content/content-bridge.ts'],
      run_at: 'document_start',
      world: 'ISOLATED',
    },
  ],
  permissions: ['scripting'],
  host_permissions: ['<all_urls>'],
  icons: {
    '16': 'public/icon.svg',
    '48': 'public/icon.svg',
    '128': 'public/icon.svg',
  },
})
