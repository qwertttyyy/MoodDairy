import { expect, test } from '@playwright/test'

import { mockAuthenticatedApi } from './support'

test('applies the saved theme early, shows build data and fits narrow layouts', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'moods_settings',
      JSON.stringify({ darkMode: true, reduceTransparency: false, chartSmooth: true }),
    )
  })
  await mockAuthenticatedApi(page)
  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000000')

  await page.getByRole('button', { name: 'Настройки' }).click()
  await expect(page.getByText(/Moods v1\.2\.0 · сборка \S+/)).toBeVisible()

  await page.setViewportSize({ width: 320, height: 568 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  await page.setViewportSize({ width: 844, height: 390 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'Записи' }).click()
  const content = await page.locator('#tab-home').boundingBox()
  expect(content?.width).toBeLessThanOrEqual(720)

  await page.goto('/missing-page')
  await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible()
})

test('public page follows live system theme changes', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('moods_settings', JSON.stringify({ darkMode: false }))
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.route('**/api/sharing/token/data/', (route) =>
    route.fulfill({ json: { is_encrypted: false, data_blob: '[]' } }),
  )
  await page.goto('/share/token/')

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000000')

  await page.setViewportSize({ width: 320, height: 568 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f2f2f7')
})

test('replaces an old chart with a fixed skeleton while the next period loads', async ({
  page,
}) => {
  await mockAuthenticatedApi(page)

  let releaseNextPeriod!: () => void
  const nextPeriodBlocked = new Promise<void>((resolve) => {
    releaseNextPeriod = resolve
  })
  let markRequested!: () => void
  const nextPeriodRequested = new Promise<void>((resolve) => {
    markRequested = resolve
  })
  const now = new Date()

  await page.route('**/api/entries/**', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname !== '/api/entries/') return route.fallback()

    if (url.searchParams.get('period') === '2weeks') {
      markRequested()
      await nextPeriodBlocked
      return route.fulfill({ json: [] })
    }

    const isCurrentMonth =
      url.searchParams.get('year') === String(now.getFullYear()) &&
      url.searchParams.get('month') === String(now.getMonth() + 1)
    return route.fulfill({
      json: isCurrentMonth
        ? [
            {
              mood: '7',
              anxiety: '2',
              timestamp: now.toISOString(),
            },
          ]
        : [],
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'График' }).click()
  await expect(page.locator('.chart-avg')).toHaveText('7.0')

  await page.getByRole('tab', { name: '2 нед' }).click()
  await nextPeriodRequested
  const skeleton = page.locator('.chart-skeleton')
  await expect(skeleton).toBeVisible()
  await expect(page.locator('.chart-avg')).toBeHidden()
  const height = await skeleton.evaluate((element) => element.getBoundingClientRect().height)
  expect(height).toBe(342)

  releaseNextPeriod()
  await expect(page.getByText('Нет данных')).toBeVisible()
})
