import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
const edition = process.env.VITE_MEDIAATLAS_EDITION === 'v1' ? 'v1' : 'v2'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: edition === 'v1' ? 'MedyaAtlas V1' : 'MedyaAtlas V2',
        short_name: edition === 'v1' ? 'Atlas V1' : 'MedyaAtlas',
        description: 'GPS’li fotoğraf ve videolarını dünya haritasında gör.',
        theme_color: '#0b1620',
        background_color: '#0b1620',
        display: 'standalone',
        orientation: 'any',
        lang: 'tr',
        start_url: base,
        scope: base,
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: `${base}index.html`.replace('//', '/'),
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  define: {
    global: 'globalThis',
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_EDITION__: JSON.stringify(edition),
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
  // `vite preview` de aynı yerel API’ye gitsin (sürücü listesi vb.)
  preview: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  optimizeDeps: {
    include: ['gpmf-extract', 'gopro-telemetry', 'mp4box', 'buffer'],
  },
})
