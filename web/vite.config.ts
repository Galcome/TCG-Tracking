import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Native shells consume the bundle but do not need (and must not register)
      // a browser service worker. Keeping the plugin enabled still resolves the
      // virtual module imported by main.tsx, which becomes a no-op in this mode.
      disable: mode === 'mobile',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'TCG Investments',
        short_name: 'TCG Investments',
        description: 'Inventory, sales, and profit ledger for a trading-card store.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#0a0e1a',
        background_color: '#0a0e1a',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Only immutable build assets and the app shell are precached. There is
        // intentionally no runtimeCaching rule: API, auth, and ledger responses
        // must always come from the network and never persist in a browser cache.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
      // The icon PNGs are already covered by the shell glob above. Avoid adding
      // the same files a second time through manifest-icon auto inclusion.
      includeManifestIcons: false,
    }),
  ],
  server: { port: 5173 },
}))
