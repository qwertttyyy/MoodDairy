import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { expectNoSeriousAxeViolations, mockAuthenticatedApi } from './support'

test.use({ viewport: { width: 390, height: 844 } })

async function prepareEntry(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Новая запись' })
  await editor
    .getByRole('group', { name: 'Как настроение?' })
    .getByRole('button', { name: '7', exact: true })
    .click()
  await editor.getByLabel('Заметка', { exact: true }).fill('Проверка сохранения')
  return editor
}

test('a fast online save does not flash local-only or syncing messages', async ({ page }) => {
  await mockAuthenticatedApi(page)
  let creates = 0
  await page.route('**/api/entries/', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: [] })
    creates++
    return route.fulfill({
      status: 201,
      json: { ...route.request().postDataJSON(), id: 88, tags: [] },
    })
  })
  const editor = await prepareEntry(page)
  await page.evaluate(() => {
    const check = () => {
      if (document.querySelector('.offline-notice, .feed-sync'))
        document.documentElement.dataset.syncNoticeFlashed = 'true'
    }
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true })
  })
  await editor.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByText('Запись добавлена', { exact: true })).toBeVisible()
  await expect(page.locator('.feed-row')).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const request = indexedDB.open('moods-offline', 1)
          request.onsuccess = () => resolve(request.result)
        })
        const keys = await new Promise<IDBValidKey[]>((resolve) => {
          const request = db.transaction('vault').objectStore('vault').getAllKeys()
          request.onsuccess = () => resolve(request.result)
        })
        db.close()
        return keys.filter((key) => typeof key === 'string' && key.includes(':outbox:')).length
      }),
    )
    .toBe(0)
  expect(creates).toBe(1)
  await expect(page.locator('.toast')).not.toContainText('на устройстве')
  await expect(page.locator('html')).not.toHaveAttribute('data-sync-notice-flashed', 'true')
})

test('a slow online save keeps the entry and shows its delivery status until confirmed', async ({
  page,
}) => {
  await mockAuthenticatedApi(page)
  let finish = () => {}
  const gate = new Promise<void>((resolve) => {
    finish = resolve
  })
  await page.route('**/api/entries/', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: [] })
    await gate
    return route.fulfill({
      status: 201,
      json: { ...route.request().postDataJSON(), id: 88, tags: [] },
    })
  })
  const editor = await prepareEntry(page)
  await editor.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(page.getByText('Проверка сохранения', { exact: true })).toBeVisible()
  await expect(page.getByText('Отправляем записи…', { exact: true })).toBeVisible()
  await expect(page.getByText('На устройстве · ожидает отправки', { exact: true })).toBeVisible()
  finish()
  await expect(page.locator('.offline-notice, .feed-sync')).toHaveCount(0)
  await expect(page.getByText('Проверка сохранения', { exact: true })).toHaveCount(1)
})

test('a failed delivery is visible even when the browser reports an online connection', async ({
  page,
}) => {
  await mockAuthenticatedApi(page)
  await page.route('**/api/entries/', (route) => route.abort('failed'))
  const editor = await prepareEntry(page)
  await editor.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(await page.evaluate(() => navigator.onLine)).toBe(true)
  await expect(page.getByText('Нет связи · дневник на устройстве', { exact: true })).toBeVisible()
  await expect(page.getByText('На устройстве · ожидает отправки', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Повторить синхронизацию' })).toBeVisible()
  await expect(page.getByText('Проверка сохранения', { exact: true })).toHaveCount(1)
})

for (const darkMode of [false, true]) {
  for (const width of [320, 390]) {
    test(`discard dialog has comfortable button padding: ${darkMode ? 'dark' : 'light'}, ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 844 })
      await page.addInitScript(
        (settings) => localStorage.setItem('moods_settings', JSON.stringify(settings)),
        { darkMode },
      )
      await mockAuthenticatedApi(page)
      const editor = await prepareEntry(page)
      await editor.getByRole('button', { name: 'Закрыть', exact: true }).click()
      const confirm = page.getByRole('dialog', { name: 'Отменить изменения?' })
      await expect(confirm).toBeVisible()
      await expect(confirm.locator('.modal')).toHaveCSS(
        'transform',
        /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/,
      )
      for (const fontSize of ['16px', '20px']) {
        await page.addStyleTag({ content: `:root { font-size: ${fontSize}; }` })
        const metrics = await confirm.locator('button').evaluateAll((buttons) =>
          buttons.map((button) => {
            const range = document.createRange()
            range.selectNodeContents(button)
            const text = range.getBoundingClientRect()
            const rect = button.getBoundingClientRect()
            return {
              top: text.top - rect.top,
              bottom: rect.bottom - text.bottom,
              left: text.left - rect.left,
              right: rect.right - text.right,
              height: rect.height,
              overflow: button.scrollWidth > button.clientWidth,
            }
          }),
        )
        for (const button of metrics) {
          expect(button.height).toBeGreaterThanOrEqual(44)
          expect(button.top).toBeGreaterThanOrEqual(10)
          expect(button.bottom).toBeGreaterThanOrEqual(10)
          expect(button.left).toBeGreaterThanOrEqual(12)
          expect(button.right).toBeGreaterThanOrEqual(12)
          expect(button.overflow).toBe(false)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
      }
      await expectNoSeriousAxeViolations(page)
      await page.screenshot({
        path: `/tmp/moods-save-feedback/${info.project.name}-${darkMode ? 'dark' : 'light'}-${width}.png`,
      })
    })
  }
}
