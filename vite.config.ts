import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages proje adresi: /MedyaAtlas/
  base: process.env.GITHUB_ACTIONS ? '/MedyaAtlas/' : '/',
  plugins: [react()],
  define: {
    global: 'globalThis',
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        // Büyük video Range isteklerinde tamponlamayı gevşet
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.url?.startsWith('/api/media/') || req.url?.startsWith('/api/transcoded/')) {
              proxyReq.setHeader('Connection', 'keep-alive')
            }
          })
        },
      },
    },
  },
  optimizeDeps: {
    include: ['gpmf-extract', 'gopro-telemetry', 'mp4box', 'buffer'],
  },
})
