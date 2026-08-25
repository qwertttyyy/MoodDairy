import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'

const AppPage = lazy(() => import('./pages/AppPage/AppPage'))
const SharePage = lazy(() => import('./pages/SharePage/SharePage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

export function AppRouter() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppPage />} />
          {/* Ссылки врачу выдавались со слешом на конце — принимаем оба варианта. */}
          <Route path="/share/:token" element={<SharePage />} />
          <Route path="/share/:token/" element={<SharePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </Suspense>
  )
}

function RouteLoading() {
  return (
    <main className="query-state" role="status" aria-live="polite" aria-busy="true">
      <span className="spinner" aria-hidden="true" />
      <span>Открываем приложение…</span>
    </main>
  )
}
