import { Capacitor } from '@capacitor/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'

import { App } from './App'
import { AuthProvider } from './auth'
import './index.css'

// PWA updates belong to the browser build only. A native WebView owns its
// lifecycle and must never install a second service-worker cache beside the
// bundled Capacitor assets. The mobile build guard also keeps local previews of
// the mobile bundle deterministic.
if (import.meta.env.MODE !== 'mobile' && !Capacitor.isNativePlatform()) {
  registerSW({ immediate: true })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Neon cold-starts after idle; one retry smooths that over.
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
