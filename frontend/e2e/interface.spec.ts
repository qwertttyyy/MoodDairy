import { createCipheriv, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { expectNoSeriousAxeViolations, mockAuthenticatedApi } from './support'

async function longFeed(page: Page, nextPageFails = false) {
  await mockAuthenticatedApi(page)
  await page.route('**/api/entries/grouped/**', (route) => {
    if (new URL(route.request().url()).searchParams.has('before'))
      return route.fulfill({
        status: 503,
        json: { error: { code: 'internal_error', message: 'Попробуйте позже' } },
      })
    const results: Record<string, unknown[]> = {}
    for (let index = 0; index < (nextPageFails ? 7 : 40); index++) {
      const date = new Date()
      date.setDate(date.getDate() - index)
      const day = date.toISOString().slice(0, 10)
      results[day] = [
        {
          id: index + 1,
          mood: String((index % 5) + 4),
          anxiety: '2',
          note: `Запись номер ${index + 1}`,
          tags: [],
          timestamp: date.toISOString(),
        },
      ]
    }
    return route.fulfill({ json: { results, next_before: nextPageFails ? '2026-01-01' : null } })
  })
}

test.use({ viewport: { width: 375, height: 812 } })

test('restores the feed scroll position after visiting another tab', async ({ page }) => {
  await longFeed(page)
  await page.goto('/')
  await expect(page.getByText('Запись номер 40', { exact: true })).toBeAttached()
  await page.evaluate(() => window.scrollTo(0, 1200))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200)
  await page.getByRole('navigation').getByRole('button', { name: 'График' }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.getByRole('navigation').getByRole('button', { name: 'Записи' }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200)
})

test('keeps the draft when cancelling an accidental close', async ({ page }) => {
  await mockAuthenticatedApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Новая запись' })
  await editor.getByLabel('Заметка', { exact: true }).fill('Не терять этот черновик')
  await editor.getByRole('button', { name: 'Закрыть', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Отменить изменения?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(confirm).toBeHidden()
  await expect(editor.getByLabel('Заметка', { exact: true })).toHaveValue('Не терять этот черновик')
  await page.keyboard.press('Escape')
  await confirm.getByRole('button', { name: 'Не сохранять', exact: true }).click()
  await expect(editor).toBeHidden()
})

test('changing form scores does not render every row underneath the dialog', async ({ page }) => {
  await longFeed(page)
  await page.goto('/')
  await expect(page.locator('.feed-row')).toHaveCount(40)
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Новая запись' })
  await expect(editor).toBeVisible()
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(Date.prototype, 'toLocaleTimeString')
      ?.value as Date['toLocaleTimeString']
    document.documentElement.dataset.testTimeFormats = '0'
    Date.prototype.toLocaleTimeString = function (...args) {
      document.documentElement.dataset.testTimeFormats = String(
        Number(document.documentElement.dataset.testTimeFormats) + 1,
      )
      return original.apply(this, args)
    }
  })
  await editor
    .getByRole('group', { name: 'Как настроение?' })
    .getByRole('button', { name: '7', exact: true })
    .click()
  await expect(editor.getByText('Хорошо', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => Number(document.documentElement.dataset.testTimeFormats))).toBe(
    0,
  )
})

test('a next-page failure keeps already loaded diary rows', async ({ page }) => {
  await longFeed(page, true)
  await page.goto('/')
  await expect(page.getByText('Запись номер 1', { exact: true })).toBeVisible()
  await page.locator('.scroll-loader').scrollIntoViewIfNeeded()
  await expect(
    page.getByText('Не удалось загрузить следующие записи', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Запись номер 1', { exact: true })).toBeAttached()
  await expect(page.locator('.feed-row')).toHaveCount(7)
})

test('repeated Enter creates only one tag while the request is pending', async ({ page }) => {
  await mockAuthenticatedApi(page)
  let creates = 0
  let finish = () => {}
  const gate = new Promise<void>((resolve) => {
    finish = resolve
  })
  await page.route('**/api/tags/', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: [] })
    creates++
    await gate
    return route.fulfill({ json: { id: 1, name: 'Сон' }, status: 201 })
  })
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'Настройки' }).click()
  await page.getByLabel('Название нового тега').fill('Сон')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  expect(creates).toBe(1)
  finish()
  await expect(page.getByText('Тег добавлен', { exact: true })).toBeVisible()
})

test('unreadable chart entries are explained rather than shown as an empty diary', async ({
  page,
}) => {
  await mockAuthenticatedApi(page)
  await page.route('**/api/entries/?*', (route) =>
    route.fulfill({ json: [{ mood: 'broken', anxiety: '', timestamp: new Date().toISOString() }] }),
  )
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'График' }).click()
  await expect(page.getByText(/Записи есть, но их не удалось расшифровать/)).toBeVisible()
  await expect(page.getByText('Добавь запись, чтобы увидеть график')).toHaveCount(0)
})

test('adding the missing fragment key reopens the shared diary without a reload', async ({
  page,
}) => {
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = JSON.stringify([
    {
      mood: 7,
      anxiety: 2,
      note: 'Открыто после добавления ключа',
      timestamp: new Date().toISOString(),
    },
  ])
  const encrypted = Buffer.concat([
    cipher.update(body, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  await page.route('**/api/sharing/token/data/', (route) =>
    route.fulfill({
      json: {
        is_encrypted: true,
        data_blob: `${iv.toString('base64')}:${encrypted.toString('base64')}`,
      },
    }),
  )
  await page.goto('/share/token/')
  await expect(page.getByRole('heading', { name: 'Ключ отсутствует' })).toBeVisible()
  await page.evaluate((hash) => {
    location.hash = hash
  }, key.toString('base64'))
  await expect(page.getByText('Открыто после добавления ключа', { exact: true })).toBeVisible()
})

for (const darkMode of [false, true]) {
  for (const reduceTransparency of [false, true]) {
    test(`theme ${darkMode ? 'dark' : 'light'}, transparency ${reduceTransparency ? 'reduced' : 'normal'}`, async ({
      page,
    }, info) => {
      await page.addInitScript(
        (settings) => localStorage.setItem('moods_settings', JSON.stringify(settings)),
        { darkMode, reduceTransparency },
      )
      await mockAuthenticatedApi(page, true)
      await page.goto('/')
      await expect(page.locator('.feed-row')).toBeVisible()
      await page.addStyleTag({ content: ':root { --safe-b: 34px; }' })
      const dock = await page.locator('.tab-dock').boundingBox()
      expect(dock).not.toBeNull()
      expect(Math.round(812 - (dock!.y + dock!.height))).toBe(34)
      for (const selector of ['.tab-bar', '.page-info']) {
        const material = await page.locator(selector).evaluate((element) => {
          const style = getComputedStyle(element)
          return {
            background: style.backgroundColor,
            blur:
              style.getPropertyValue('backdrop-filter') ||
              style.getPropertyValue('-webkit-backdrop-filter'),
          }
        })
        if (reduceTransparency) {
          expect(material.background).toMatch(/^rgb\(/)
          expect(material.blur).toBe('none')
        } else expect(material.blur).toContain('blur(')
      }
      await page.screenshot({
        path: `/tmp/moods-frontend-review/${info.project.name}-${darkMode ? 'dark' : 'light'}-${reduceTransparency ? 'reduced' : 'normal'}-feed.png`,
      })
      await page.getByRole('button', { name: 'Добавить запись', exact: true }).click()
      const editor = page.getByRole('dialog', { name: 'Новая запись' })
      await expect(editor).toBeVisible()
      await expect
        .poll(async () => {
          const targets = await editor
            .locator('.scale-cell, .field-guide-btn')
            .evaluateAll((elements) =>
              elements.map((element) => {
                const rect = element.getBoundingClientRect()
                return { width: rect.width, height: rect.height }
              }),
            )
          return targets.every((target) => target.width >= 44 && target.height >= 44)
        })
        .toBe(true)
      await expectNoSeriousAxeViolations(page)
      await page.screenshot({
        path: `/tmp/moods-frontend-review/${info.project.name}-${darkMode ? 'dark' : 'light'}-${reduceTransparency ? 'reduced' : 'normal'}-editor.png`,
      })
      await editor.getByRole('button', { name: 'Закрыть', exact: true }).click()
      await expect(editor).toBeHidden()
      await page.getByRole('navigation').getByRole('button', { name: 'Настройки' }).click()
      await expectNoSeriousAxeViolations(page)
      await page.setViewportSize({ width: 812, height: 375 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    })
  }
}

test('system transparency preference is reflected in settings', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query) => {
      const media = original(query)
      if (query === '(prefers-reduced-transparency: reduce)')
        Object.defineProperty(media, 'matches', { value: true })
      return media
    }
  })
  await mockAuthenticatedApi(page)
  await page.goto('/')
  await expect(page.locator('html')).toHaveClass(/reduce-transparency/)
  await page.getByRole('navigation').getByRole('button', { name: 'Настройки' }).click()
  const transparency = page.getByRole('checkbox', { name: 'Уменьшить прозрачность' })
  await expect(transparency).toBeChecked()
  await expect(transparency).toBeDisabled()
  await expect(
    page.getByText('Уменьшение прозрачности включено в настройках устройства.'),
  ).toBeVisible()
})

test('320px screen keeps setting labels and form controls readable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await mockAuthenticatedApi(page)
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'Настройки' }).click()
  await expect(page.getByText('Уменьшить прозрачность', { exact: true })).toBeVisible()
  const clipped = await page
    .locator('.set-row-toggle .set-label')
    .evaluateAll((labels) =>
      labels.some(
        (label) => label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight,
      ),
    )
  expect(clipped).toBe(false)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Новая запись' })
  await expect(editor).toBeVisible()
  await expect
    .poll(() =>
      editor
        .locator('.scale-cell')
        .evaluateAll((cells) =>
          cells.every(
            (cell) =>
              cell.getBoundingClientRect().width >= 44 && cell.getBoundingClientRect().height >= 44,
          ),
        ),
    )
    .toBe(true)
  await expect(editor.getByRole('button', { name: 'Добавить', exact: true })).toBeInViewport()
  expect(
    await editor
      .locator('.modal')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
})

test('an unavailable local vault still allows an online create', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(IDBFactory.prototype, 'open', {
      value: () => {
        throw new DOMException('Storage blocked', 'SecurityError')
      },
    })
  })
  await mockAuthenticatedApi(page)
  let creates = 0
  await page.route('**/api/entries/', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: [] })
    creates++
    return route.fulfill({
      status: 201,
      json: { ...route.request().postDataJSON(), id: 88, tags: [] },
    })
  })
  await page.goto('/')
  await expect(page.getByText('Локальное хранилище недоступно', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Новая запись' })
  await editor
    .getByRole('group', { name: 'Как настроение?' })
    .getByRole('button', { name: '7', exact: true })
    .click()
  await editor.getByLabel('Заметка', { exact: true }).fill('Сохранено без IndexedDB')
  await editor.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(page.getByText('Сохранено без IndexedDB', { exact: true })).toBeVisible()
  await expect(page.getByText('Запись добавлена', { exact: true })).toBeVisible()
  expect(creates).toBe(1)
  await expect(page.getByText('Локальное хранилище недоступно', { exact: true })).toBeVisible()
})
