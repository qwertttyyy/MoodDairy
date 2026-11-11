import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { mockAuthenticatedApi } from './support'

test.use({ viewport: { width: 390, height: 844 } })

async function openDraft(page: Page, note: string) {
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Новая запись' })
  await editor
    .getByRole('group', { name: 'Как настроение?' })
    .getByRole('button', { name: '8', exact: true })
    .click()
  await editor.getByLabel('Заметка', { exact: true }).fill(note)
  return editor
}

test('closing the saved form preserves its contents and starts moving without a pause', async ({
  page,
}) => {
  await mockAuthenticatedApi(page)
  await page.route('**/api/entries/', (route) =>
    route.fulfill({ status: 201, json: { ...route.request().postDataJSON(), id: 88, tags: [] } }),
  )
  await page.goto('/')
  const editor = await openDraft(page, 'Плавное закрытие')
  await editor.evaluate((dialog) => {
    const observer = new MutationObserver(() => {
      if (dialog.getAttribute('data-morph') !== 'out') return
      observer.disconnect()
      const box = dialog.querySelector<HTMLElement>('.modal')!
      const animation = box.getAnimations()[0]
      document.documentElement.dataset.closingMood =
        dialog.querySelector('.mood-scale [aria-pressed="true"]')?.textContent ?? ''
      document.documentElement.dataset.closingInert = String(box.inert)
      if (animation) {
        animation.pause()
        void animation.ready.then(() => {
          animation.currentTime = 85
          document.documentElement.dataset.closingScale = String(
            box.getBoundingClientRect().width / box.offsetWidth,
          )
        })
      }
    })
    observer.observe(dialog, { attributes: true, attributeFilter: ['data-morph'] })
  })
  await editor.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-closing-mood', '8')
  await expect(page.locator('html')).toHaveAttribute('data-closing-inert', 'true')
  await expect
    .poll(() => page.evaluate(() => Number(document.documentElement.dataset.closingScale)))
    .toBeLessThan(0.8)
  await expect(editor).toBeHidden()
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click()
  await expect(editor.locator('.mood-scale [aria-pressed="true"]')).toHaveCount(0)
  await expect(editor.getByLabel('Заметка', { exact: true })).toHaveValue('')
})

test('local-to-server handoff never duplicates or reorders entries with the same timestamp', async ({
  page,
}) => {
  await mockAuthenticatedApi(page)
  let creates = 0
  await page.route('**/api/entries/', (route) => {
    creates++
    return route.fulfill({
      status: 201,
      json: { ...route.request().postDataJSON(), id: 80 + creates, tags: [] },
    })
  })
  await page.addInitScript(() => {
    const originalDelete = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'delete')
      ?.value as IDBObjectStore['delete']
    IDBObjectStore.prototype.delete = function (key) {
      const request = originalDelete.call(this, key)
      if (typeof key === 'string' && key.includes(':outbox:')) {
        const transaction = this.transaction
        transaction.addEventListener(
          'complete',
          (event) => {
            event.stopImmediatePropagation()
            // Keep the durable queue's completion callback pending across paints.
            window.setTimeout(() => transaction.dispatchEvent(new Event('complete')), 250)
          },
          { once: true },
        )
      }
      return request
    }
  })
  await page.goto('/')
  await page.evaluate(() => {
    const check = () => {
      const notes = [...document.querySelectorAll('.feed-note')].map((node) => node.textContent)
      const latest = document.documentElement.dataset.latestDraft ?? ''
      if (new Set(notes).size !== notes.length)
        document.documentElement.dataset.duplicateDuringSave = 'true'
      if (notes.includes(latest) && notes[0] !== latest)
        document.documentElement.dataset.reorderedDuringSave = 'true'
    }
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true })
  })
  const notes = ['Первая запись', 'Вторая запись']
  for (const note of notes) {
    const editor = await openDraft(page, note)
    await editor.getByLabel('Дата записи', { exact: true }).fill('2026-01-01')
    await editor.getByLabel('Время записи', { exact: true }).fill('12:34')
    await page.evaluate((latest) => {
      document.documentElement.dataset.latestDraft = latest
    }, note)
    await editor.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(editor).toBeHidden()
    await expect(page.getByText(note, { exact: true })).toHaveCount(1)
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
  }
  await expect(page.locator('.feed-note')).toHaveText([...notes].reverse())
  await expect(page.locator('html')).not.toHaveAttribute('data-duplicate-during-save', 'true')
  await expect(page.locator('html')).not.toHaveAttribute('data-reordered-during-save', 'true')
  expect(creates).toBe(2)
})

test('creating and editing keep seconds and milliseconds when the time fields are unchanged', async ({
  page,
}) => {
  const timestamp = '2026-11-11T18:09:10.123Z'
  await page.clock.setFixedTime(new Date(timestamp))
  await mockAuthenticatedApi(page)
  const submitted: string[] = []
  await page.route('**/api/entries/**', (route) => {
    if (!['POST', 'PUT'].includes(route.request().method())) return route.fallback()
    const body = route.request().postDataJSON() as { timestamp: string }
    submitted.push(body.timestamp)
    return route.fulfill({ status: 201, json: { ...body, id: 88, tags: [] } })
  })
  await page.goto('/')
  const editor = await openDraft(page, 'С точным временем')
  await editor.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(page.locator('.feed-row')).toHaveCount(1)
  await expect.poll(() => submitted.length).toBe(1)
  // Let the accepted row finish replacing its outbox copy before editing it.
  await page.getByText('С точным временем', { exact: true }).click()
  const editing = page.getByRole('dialog', { name: 'Редактировать' })
  await editing.getByLabel('Заметка', { exact: true }).fill('Изменена только заметка')
  await editing.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editing).toBeHidden()
  expect(submitted).toEqual([timestamp, timestamp])
})
