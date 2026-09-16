import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'


// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react()
    , VitePWA({ // <-- PWA Ayarları Buradan Başlıyor
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Bluetech Panel',
        short_name: 'Bluetech Panel',
        description: 'EV Şarj İstasyonu Yönetim Paneli',
        theme_color: '#070e1a',
        background_color: '#070e1a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  , tailwindcss()],
  server: {
    host: `0.0.0.0`,
    port: 5173,
    allowedHosts: ["btcharge.services"],
    proxy: {
      '/api': process.env.VITE_API_PROXY_TARGET || 'http://localhost:8005'
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
})

