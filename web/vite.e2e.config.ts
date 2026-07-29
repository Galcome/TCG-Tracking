/**
 * Vite config used only by the end-to-end suite.
 *
 * It differs from the production config in exactly one way: the Firebase Auth SDK is
 * aliased to a stub. Everything else - the components, the API client, the money
 * formatting, the routing - is the shipped code, talking to a real API over real HTTP.
 *
 * Doing it here rather than behind a runtime flag in src/ means the production bundle has
 * no test path in it at all.
 */
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const stub = fileURLToPath(new URL('./e2e/firebase-stub.ts', import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^firebase\/app$/, replacement: stub },
      { find: /^firebase\/auth$/, replacement: stub },
    ],
  },
  // Playwright passes --port explicitly; this is only the bare `vite --config` fallback.
  server: { port: 5273 },
})
