import { randomBytes, createCipheriv } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'

interface WireEntry {
  id: number
  mood: string
  note: string
  anxiety: string
  tags: { id: number; name: string }[]
  timestamp: string
}

async function diaryServer(context: BrowserContext, loseFirstResponse = false) {
  const key = randomBytes(32)
  const encrypted = (text: string) => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const value = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()])
    return `${iv.toString('base64')}:${value.toString('base64')}`
  }
  const entries: WireEntry[] = [
    {
      id: 1,
      mood: encrypted('7'),
      anxiety: encrypted('2'),
      note: encrypted('Запись из сети'),
      tags: [],
      timestamp: new Date().toISOString(),
    },
  ]
  await context.addInitScript((keyB64) => {
    if (!localStorage.getItem('test-seeded')) {
      sessionStorage.setItem('enc_key', keyB64)
      sessionStorage.setItem('enc_key_owner', '1')
      localStorage.setItem('test-seeded', '1')
    }
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => localStorage.getItem('test-offline') !== 'true',
    })
  }, key.toString('base64'))
  const initialized = await context.request.post('/__test__/diary', {
    data: { entries, loseFirstResponse },
  })
  expect(initialized.ok()).toBe(true)
  return {
    posts: async () => {
      const response = await context.request.get('/__test__/status')
      return ((await response.json()) as { posts: number }).posts
    },
    setAccount: async (id: number) => {
      await context.request.post('/__test__/account', { data: { id } })
    },
  }
}

async function vaultContents(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('moods-offline', 1)
        request.onsuccess = () => {
          const db = request.result
          const values = db.transaction('vault').objectStore('vault').getAll()
          values.onsuccess = () => {
            resolve(JSON.stringify(values.result))
            db.close()
          }
          values.onerror = () => reject(values.error)
        }
        request.onerror = () => reject(request.error)
      }),
  )
}

async function offline(context: BrowserContext, page: Page) {
  // Cut the origin connection instead of WebKit's broken SW offline emulation:
  // https://github.com/microsoft/playwright/issues/42775
  await context.request.post('/__test__/network', { data: { offline: true } })
  await page.evaluate(() => {
    localStorage.setItem('test-offline', 'true')
    window.dispatchEvent(new Event('offline'))
  })
}

async function online(context: BrowserContext, page: Page) {
  await context.request.post('/__test__/network', { data: { offline: false } })
  await page.evaluate(() => {
    localStorage.removeItem('test-offline')
    window.dispatchEvent(new Event('online'))
  })
}

async function createEntry(page: Page, note: string, sameTimestamp = false) {
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Новая запись' })
  await form
    .getByRole('group', { name: 'Как настроение?' })
    .getByRole('button', { name: '8', exact: true })
    .click()
  await form.getByLabel('Заметка', { exact: true }).fill(note)
  if (sameTimestamp) {
    await form.getByLabel('Дата записи', { exact: true }).fill('2026-01-01')
    await form.getByLabel('Время записи', { exact: true }).fill('12:34')
  }
  await form.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(form).toBeHidden()
  await expect(page.getByText(note, { exact: true })).toBeVisible()
}

test('encrypted diary survives cold offline launches, queues a create and syncs once', async ({
  context,
  page,
}) => {
  const server = await diaryServer(context)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByText('Запись из сети', { exact: true })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open('moods-offline', 1)
          r.onsuccess = () => resolve(r.result)
        })
        const present = await new Promise<boolean>((resolve) => {
          const r = db.transaction('vault').objectStore('vault').get('session')
          r.onsuccess = () => resolve(Boolean(r.result))
        })
        db.close()
        return present
      }),
    )
    .toBe(true)
  await offline(context, page)
  await page.evaluate(() => sessionStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Запись из сети', { exact: true })).toBeVisible()
  await createEntry(page, 'Оффлайн заметка после закрытия')
  await expect(page.getByText('На устройстве · ожидает отправки')).toBeVisible()
  expect(await server.posts()).toBe(0)
  const stored = await vaultContents(page)
  expect(stored).not.toContain('Запись из сети')
  expect(stored).not.toContain('Оффлайн заметка после закрытия')

  await page.close()
  const cold = await context.newPage()
  await cold.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(cold.getByText('Запись из сети', { exact: true })).toBeVisible()
  await expect(cold.getByText('Оффлайн заметка после закрытия', { exact: true })).toBeVisible()
  await online(context, cold)
  await expect.poll(server.posts).toBe(1)
  await expect(cold.getByText('На устройстве · ожидает отправки')).toHaveCount(0)
  await expect(cold.getByText('Оффлайн заметка после закрытия', { exact: true })).toHaveCount(1)

  await offline(context, cold)
  await cold.reload({ waitUntil: 'domcontentloaded' })
  await expect(cold.getByText('Оффлайн заметка после закрытия', { exact: true })).toBeVisible()
  await online(context, cold)
  await cold.getByRole('navigation').getByRole('button', { name: 'Настройки' }).click()
  await cold.getByRole('button', { name: 'Выход', exact: true }).click()
  await cold
    .getByRole('dialog', { name: 'Выйти из аккаунта?' })
    .getByRole('button', { name: 'Выйти', exact: true })
    .click()
  await expect(cold.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
  expect(await vaultContents(cold)).toBe('[]')
})

test('equal-time offline entries keep their order throughout synchronization and reload', async ({
  context,
  page,
}) => {
  const server = await diaryServer(context)
  await page.goto('/')
  await expect(page.getByText('Запись из сети', { exact: true })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await offline(context, page)
  await createEntry(page, 'Раньше в очереди', true)
  await createEntry(page, 'Позже в очереди', true)
  const queuedNotes = page.locator('.feed-note').filter({ hasText: 'в очереди' })
  await expect(queuedNotes).toHaveText(['Позже в очереди', 'Раньше в очереди'])
  await page.evaluate(() => {
    const check = () => {
      const notes = [...document.querySelectorAll('.feed-note')]
        .map((node) => node.textContent ?? '')
        .filter((note) => note.includes('в очереди'))
      if (notes.join('|') !== 'Позже в очереди|Раньше в очереди')
        document.documentElement.dataset.queueOrderChanged = 'true'
    }
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true })
  })
  await online(context, page)
  await expect.poll(server.posts).toBe(2)
  await expect(page.locator('.feed-sync')).toHaveCount(0)
  await expect(queuedNotes).toHaveText(['Позже в очереди', 'Раньше в очереди'])
  await expect(page.locator('html')).not.toHaveAttribute('data-queue-order-changed', 'true')
  await page.reload()
  await expect(queuedNotes).toHaveText(['Позже в очереди', 'Раньше в очереди'])
  expect(await server.posts()).toBe(2)
})

test('a committed POST with a lost response is reconciled without a second create', async ({
  context,
  page,
}) => {
  const server = await diaryServer(context, true)
  await page.goto('/')
  await expect(page.getByText('Запись из сети', { exact: true })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await createEntry(page, 'Не дублировать после обрыва')
  await expect.poll(server.posts).toBe(1)
  await expect(page.getByText('На устройстве · ожидает отправки')).toBeVisible()
  await expect(
    page.locator('.offline-detail').filter({ hasText: 'Не удалось подключиться' }),
  ).toBeVisible()
  await offline(context, page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Не дублировать после обрыва', { exact: true })).toBeVisible()
  await online(context, page)
  await expect(page.getByText('На устройстве · ожидает отправки')).toHaveCount(0)
  await expect(page.getByText('Не дублировать после обрыва', { exact: true })).toHaveCount(1)
  expect(await server.posts()).toBe(1)
})

test('an offline outbox is never uploaded into another authenticated account', async ({
  context,
  page,
}) => {
  const server = await diaryServer(context)
  await page.goto('/')
  await expect(page.getByText('Запись из сети', { exact: true })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)
  await offline(context, page)
  await createEntry(page, 'Только первый аккаунт')
  await server.setAccount(2)
  await online(context, page)
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
  expect(await server.posts()).toBe(0)
})

test('offline logout clears local data and does not silently reopen the server session', async ({
  context,
  page,
}) => {
  await diaryServer(context)
  await page.goto('/')
  await expect(page.getByText('Запись из сети', { exact: true })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await offline(context, page)
  await createEntry(page, 'Удалить только после предупреждения')
  await page.getByRole('navigation').getByRole('button', { name: 'Настройки' }).click()
  await page.getByRole('button', { name: 'Выход', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Выйти из аккаунта?' })
  await expect(
    confirmation.getByText(/На устройстве остались неотправленные записи: 1/),
  ).toBeVisible()
  await confirmation.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
  expect(await vaultContents(page)).toBe('[]')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
  await online(context, page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
  expect(await vaultContents(page)).toBe('[]')
})

test('a local cache failure after POST acceptance does not turn the delivered entry into a new POST', async ({
  context,
  page,
}) => {
  const server = await diaryServer(context)
  await page.goto('/')
  await expect(page.getByText('Запись из сети', { exact: true })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put')
      ?.value as IDBObjectStore['put']
    let failOnce = true
    IDBObjectStore.prototype.put = function (value, key) {
      if (failOnce && typeof key === 'string' && key.includes('cache:/api/entries/grouped/')) {
        failOnce = false
        throw new DOMException('Тест: место закончилось', 'QuotaExceededError')
      }
      return original.call(this, value, key)
    }
  })
  await createEntry(page, 'Принято сервером до ошибки кеша')
  await expect(
    page.locator('.offline-detail').filter({ hasText: 'Тест: место закончилось' }),
  ).toBeVisible()
  expect(await server.posts()).toBe(1)
  await page.getByRole('button', { name: 'Повторить синхронизацию' }).click()
  await expect(page.getByText('На устройстве · ожидает отправки')).toHaveCount(0)
  await expect(page.getByText('Принято сервером до ошибки кеша', { exact: true })).toHaveCount(1)
  expect(await server.posts()).toBe(1)
})
