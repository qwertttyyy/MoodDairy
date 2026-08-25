import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { AppRouter } from './AppRouter'
import { shouldRetry } from './shared/api/client'
import { PwaProvider } from './shared/pwa/PwaProvider'
import { ErrorBoundary } from './shared/ui/ErrorBoundary'
import { ToastProvider } from './shared/ui/ToastProvider'

import './shared/styles/base.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('Не найден корневой элемент #root')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <PwaProvider>
          <ToastProvider>
            <AppRouter />
          </ToastProvider>
        </PwaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
