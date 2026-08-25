import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// Дев-режим работает против локального Django на :8000 через прокси:
// запросы остаются same-origin, поэтому cookie-сессия живёт без настройки CORS.
const BACKEND = 'http://localhost:8000'

const packageData: unknown = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
)
if (
  typeof packageData !== 'object' ||
  packageData === null ||
  !('version' in packageData) ||
  typeof packageData.version !== 'string'
) {
  throw new Error('package.json должен содержать строковую версию')
}

function readBuildSha(): string {
  const fromEnvironment = process.env.GITHUB_SHA ?? process.env.BUILD_SHA
  if (fromEnvironment) return fromEnvironment.slice(0, 7)
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageData.version),
    __BUILD_SHA__: JSON.stringify(readBuildSha()),
  },
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
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
})
