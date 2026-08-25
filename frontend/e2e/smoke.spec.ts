import { expect, test } from '@playwright/test'

test('shows the authentication screen when no session exists', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Moods' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
})
