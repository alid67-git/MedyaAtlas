import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages proje adresi: /MedyaAtlas/
  base: process.env.GITHUB_ACTIONS ? '/MedyaAtlas/' : '/',
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5174',
    },
  },
  optimizeDeps: {
    include: ['gpmf-extract', 'gopro-telemetry', 'mp4box', 'buffer'],
  },
})
