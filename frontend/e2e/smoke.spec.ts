import { expect, test } from '@playwright/test'

test('shows the authentication screen when no session exists', async ({ page }) => {
  await page.route('**/api/config/', (route) =>
    route.fulfill({ json: { encryption_enabled: true } }),
  )
  await page.route('**/api/auth/me/', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'not_authenticated', message: 'Войдите снова' } },
    }),
  )
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Moods' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
})
