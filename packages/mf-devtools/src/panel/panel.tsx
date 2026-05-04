import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'

const container = document.getElementById('root')
if (!container) throw new Error('mf-devtools: #root missing in panel.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
