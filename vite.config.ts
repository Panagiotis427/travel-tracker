import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Content-Security-Policy for the built app. GitHub Pages can't send headers, so it's a
// <meta> tag, injected at build time only: the dev server relies on an inline script
// (React refresh) that script-src 'self' would block. connect-src allows Supabase by
// wildcard so no project identifier lives in the repo.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const CHARSET = /<meta\s+charset=[^>]*>/i;
const cspMeta: Plugin = {
  name: 'csp-meta',
  apply: 'build',
  // Straight after <meta charset> (which stays first) and before anything that loads.
  transformIndexHtml(html) {
    if (!CHARSET.test(html)) throw new Error('csp-meta: no <meta charset> in index.html to anchor the CSP after');
    return html.replace(CHARSET, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
  },
};

// base './' keeps asset paths relative so the same build works from the GitHub Pages
// sub-path, on any other static host, and as an installable desktop PWA.
export default defineConfig({
  base: './',
  // The build a device runs, shown in the sidebar: the commit in CI, "local" otherwise.
  define: { 'import.meta.env.VITE_APP_BUILD': JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) || 'local') },
  // The lazily loaded globe chunk (three.js) is ~2 MB, so warn only when a chunk would outgrow the
  // service worker's precache limit (maximumFileSizeToCacheInBytes below) and stop working offline.
  build: { chunkSizeWarningLimit: 3000 },
  server: { port: 5180, strictPort: false },
  preview: { port: 4180, strictPort: false },
  plugins: [
    cspMeta,
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
