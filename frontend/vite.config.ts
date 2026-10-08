import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { VitePWA } from 'vite-plugin-pwa'
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
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Moods',
        short_name: 'Moods',
        description: 'Личный дневник настроения',
        lang: 'ru',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f2f2f7',
        theme_color: '#f2f2f7',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,png,svg,webmanifest}'],
        inlineWorkboxRuntime: true,
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/$/, /^\/share\/[^/]+\/?$/],
        navigateFallbackDenylist: [/^\/api(?:\/|$)/, /\/[^/?]+\.[^/]+$/],
        runtimeCaching: [
          {
            urlPattern: /\/api(?:\/|$)/,
            handler: 'NetworkOnly',
          },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(packageData.version),
    __BUILD_SHA__: JSON.stringify(readBuildSha()),
  },
  build: {
    cssMinify: 'esbuild',
    manifest: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[/](react|react-dom|scheduler)[/]/,
              priority: 30,
            },
            {
              name: 'router-vendor',
              test: /node_modules[/]react-router[/]/,
              priority: 20,
            },
            {
              name: 'query-vendor',
              test: /node_modules[/]@tanstack[/]/,
              priority: 20,
            },
            {
              name: 'schema-vendor',
              test: /node_modules[/]zod[/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': BACKEND,
      '/admin': BACKEND,
      '/static': BACKEND,
      '/__debug__': BACKEND,
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
})
