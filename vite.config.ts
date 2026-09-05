import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/** `/api/*` → the save server on 3001 (docs/07), so the iPad talks to one origin. */
const API_PORT = process.env.ISI_API_PORT ?? '3001';
const API_PROXY = { '/api': { target: `http://127.0.0.1:${API_PORT}`, rewrite: (p: string) => p.replace(/^\/api/, '') } };

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Idle Solitaire Infinite',
        short_name: 'Solitaire ∞',
        description: 'A quiet desk, a deck of cards, and 52! arrangements to witness.',
        theme_color: '#1f3a34',
        background_color: '#162925',
        display: 'standalone',
        orientation: 'landscape',
        start_url: '/',
        scope: '/',
        categories: ['games'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The save API must never be served from the cache — it is the one live thing here.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true
      },
      devOptions: { enabled: false }
    })
  ],
  resolve: {
    alias: {
      $engine: fileURLToPath(new URL('./src/engine', import.meta.url)),
      $rules: fileURLToPath(new URL('./src/rules', import.meta.url)),
      $content: fileURLToPath(new URL('./src/content', import.meta.url))
    }
  },
  server: { host: '0.0.0.0', port: 3000, strictPort: true, proxy: API_PROXY },
  preview: { proxy: API_PROXY },
  build: { target: 'es2022', sourcemap: true }
});
