import { expect, test } from '@playwright/test'

import { expectNoSeriousAxeViolations, mockAuthenticatedApi } from './support'

test('открывает экран входа при отсутствии сессии', async ({ page }) => {
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
  await expectNoSeriousAxeViolations(page)
})

test('открывает запись и доступное подтверждение удаления', async ({ page }) => {
  await mockAuthenticatedApi(page, true)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Записи' })).toBeVisible()
  await page.locator('.feed-row').click()
  const editor = page.getByRole('dialog', { name: 'Редактировать' })
  await expect(editor).toBeVisible()

  const deleteButton = editor.getByRole('button', { name: 'Удалить' })
  await deleteButton.click()
  const confirmation = page.getByRole('dialog', { name: 'Удалить запись?' })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByRole('button', { name: 'Отмена' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(confirmation).toBeHidden()
  await expect(editor).toBeVisible()
  await expect(deleteButton).toBeFocused()
  await expectNoSeriousAxeViolations(page)
})

test('открывает публичную ссылку напрямую', async ({ page }) => {
  await page.route('**/api/sharing/token/data/', (route) =>
    route.fulfill({
      json: {
        is_encrypted: false,
        data_blob: JSON.stringify([
          {
            mood: 7,
            anxiety: 2,
            note: 'Спокойный день',
            timestamp: '2026-08-24T20:00:00Z',
          },
        ]),
      },
    }),
  )

  await page.goto('/share/token/')
  await expect(page.getByText('Спокойный день')).toBeVisible()
  await expectNoSeriousAxeViolations(page)
})
