import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: /pwa\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4174',
    serviceWorkers: 'allow',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'node scripts/serve-pwa-test.mjs',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'pwa' }],
})
