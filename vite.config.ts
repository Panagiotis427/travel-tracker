import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base './' keeps asset paths relative so the same build works on Cloudflare/GitHub
// Pages, inside a Capacitor Android wrapper, and as an installable desktop PWA.
export default defineConfig({
  base: './',
  server: { port: 5180, strictPort: false },
  preview: { port: 4180, strictPort: false },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Scratch Globe — Travel Tracker',
        short_name: 'Scratch Globe',
        description: 'Private 3D globe travel tracker. Zero cost, works offline, your data stays on device.',
        theme_color: '#0b1f2a',
        background_color: '#0b1f2a',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // New service worker takes over promptly on deploy (no more stale app).
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // Precache the shell + base globe so first offline load works; the big
        // three.js chunk fits under the limit. Detail layers + admin-1 + textures
        // are cached on demand at runtime instead of bloating the precache.
        globPatterns: [
          '**/*.{js,css,html,svg,png,woff2}',
          'geo/world_110m.topojson',
          'geo/world_50m.topojson',
        ],
        maximumFileSizeToCacheInBytes: 3_000_000,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/geo/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'geo-data',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/textures/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'textures',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
