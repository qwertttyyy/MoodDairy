import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function expectNoSeriousAxeViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa'])
  if (include) builder = builder.include(include)
  const results = await builder.analyze()
  expect(
    results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'),
  ).toEqual([])
}

async function mockAuthenticatedApi(page: Page, withEntry = false) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith('/api/')) return route.continue()
    if (path === '/api/config/') return route.fulfill({ json: { encryption_enabled: false } })
    if (path === '/api/auth/me/') return route.fulfill({ json: { id: 1, username: 'tester' } })
    if (path === '/api/entries/grouped/') {
      return route.fulfill({
        json: {
          results: withEntry
            ? {
                '2026-08-24': [
                  {
                    id: 12,
                    mood: '7',
                    note: 'Заметка',
                    anxiety: '2',
                    tags: [],
                    timestamp: '2026-08-24T20:00:00Z',
                  },
                ],
              }
            : {},
          next_before: null,
        },
      })
    }
    if (path === '/api/entries/') return route.fulfill({ json: [] })
    if (path === '/api/entries/date-range/') {
      return route.fulfill({ json: { first_date: null } })
    }
    if (path === '/api/tags/') return route.fulfill({ json: [] })
    if (path === '/api/sharing/') return route.fulfill({ json: { active: false } })
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Нет' } } })
  })
}

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

  const loginTab = page.getByRole('tab', { name: 'Вход' })
  await loginTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Регистрация' })).toBeFocused()
  await expect(page.getByRole('tab', { name: 'Регистрация' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByLabel('Пароль')).toHaveAttribute('autocomplete', 'new-password')

  await expectNoSeriousAxeViolations(page)
})

test('keeps focus inside a dialog and returns it to the opener', async ({ page }) => {
  await mockAuthenticatedApi(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Записи' })).toBeVisible()
  await expectNoSeriousAxeViolations(page)

  const opener = page.getByRole('button', { name: 'Шкала настроения' })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Памятка' })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Памятка' })).toBeFocused()

  await page.keyboard.press('Shift+Tab')
  await expect(opener).not.toBeFocused()
  expect(
    await dialog.evaluate(
      (node) => node === document.activeElement || node.contains(document.activeElement),
    ),
  ).toBe(true)

  await expectNoSeriousAxeViolations(page, '.modal-guide')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()

  await page.getByRole('button', { name: 'График' }).click()
  const monthTab = page.getByRole('tab', { name: 'Месяц' })
  await monthTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '2 нед' })).toBeFocused()
  await expect(page.getByRole('tab', { name: '2 нед' })).toHaveAttribute('aria-selected', 'true')
})

test('supports a confirmation dialog nested over the entry editor', async ({ page }) => {
  await mockAuthenticatedApi(page, true)
  await page.goto('/')

  const entry = page.locator('.feed-row')
  await entry.click()
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

  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  await expect(entry).toBeFocused()
})

test('public diary screen has no serious accessibility violations', async ({ page }) => {
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
