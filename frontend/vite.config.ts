import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Дев-режим работает против локального Django на :8000 через прокси:
// запросы остаются same-origin, поэтому cookie-сессия живёт без настройки CORS.
const BACKEND = 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  build: {
    // Lightning CSS заменяет стандартный backdrop-filter устаревшим WebKit-вариантом.
    // В Chromium он игнорируется, поэтому стекло исчезает только в production-сборке.
    cssMinify: false,
  },
  server: {
    proxy: {
      '/api': BACKEND,
      '/admin': BACKEND,
      '/static': BACKEND,
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
