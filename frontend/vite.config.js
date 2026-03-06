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
      injectRegister: 'auto',
      manifest: {
        name: 'Charge Panel v2',
        short_name: 'ChargeApp',
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
    proxy: {
      '/api':'http://192.168.1.45:8005'
    },
  },
})

