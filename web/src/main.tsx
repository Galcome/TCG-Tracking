import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './App'
import { AuthProvider } from './auth'
import { config } from './config'
import './index.css'

// Railway sleeps the API after roughly ten minutes idle and Neon suspends alongside it, so
// the first request of the day waits about four seconds for both to come back. This fires at
// module load, which means the wake happens while the user is still reading the sign-in screen
// rather than while they stare at an empty dashboard.
//
// Nothing awaits it and a failure is swallowed on purpose: this is a warm-up, not a health
// check, and the real requests that follow will surface an outage far better than this could.
// It does mean a page load with no further activity still wakes the service, which is the
// price of the trade.
void fetch(`${config.apiUrl}/health`).catch(() => {})

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
