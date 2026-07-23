import { Buffer } from 'buffer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// gopro-telemetry bazı ortamlarda Buffer bekler
;(window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
globalThis.Buffer = Buffer

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
