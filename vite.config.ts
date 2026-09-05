import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

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
        background_color: '#16292500'.slice(0, 7),
        display: 'standalone',
        orientation: 'landscape',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
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
  server: { host: '0.0.0.0', port: 3000, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: { target: 'es2022', sourcemap: true }
});
