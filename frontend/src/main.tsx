import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'

import { AppPage } from './pages/AppPage/AppPage'
import { SharePage } from './pages/SharePage/SharePage'
import { shouldRetry } from './shared/api/client'
import { ErrorBoundary } from './shared/ui/ErrorBoundary'
import { ToastProvider } from './shared/ui/ToastProvider'

import './shared/styles/styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: shouldRetry, refetchOnWindowFocus: false },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('Не найден корневой элемент #root')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<AppPage />} />
              {/* Ссылки врачу выдавались со слешом на конце — принимаем оба варианта. */}
              <Route path="/share/:token" element={<SharePage />} />
              <Route path="/share/:token/" element={<SharePage />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
