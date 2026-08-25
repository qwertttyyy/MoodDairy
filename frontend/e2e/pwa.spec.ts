import { expect, test } from '@playwright/test'

test('is installable, keeps API out of caches and serves the offline shell', async ({
  context,
  page,
}) => {
  const cspViolations: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) cspViolations.push(message.text())
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()

  const manifestResponse = await page.request.get('/manifest.webmanifest')
  expect(manifestResponse.ok()).toBe(true)
  expect(manifestResponse.headers()['content-type']).toContain('manifest')
  const manifest: unknown = await manifestResponse.json()
  expect(manifest).toMatchObject({
    name: 'Moods',
    short_name: 'Moods',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'ru',
  })
  expect((manifest as { icons: unknown[] }).icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'maskable' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]),
  )

  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()

  expect(await cachedUrls(page)).not.toEqual(
    expect.arrayContaining([expect.stringContaining('/api/')]),
  )

  const missingAsset = await page.evaluate(async () => {
    const response = await fetch('/assets/missing.js', {
      headers: { Accept: 'application/javascript' },
    })
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
    }
  })
  expect(missingAsset.status).toBe(404)
  expect(missingAsset.contentType).not.toContain('text/html')

  // Chromium's protocol-level offline emulation does not update Navigator.onLine,
  // while a real browser connection loss does. Keep both signals aligned.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
  })
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Нет подключения к интернету' })).toBeVisible()
  await expect(page.getByText(/для авторизации и дневниковых данных нужен интернет/i)).toBeVisible()

  await page.goto('/share/offline/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Нет подключения к интернету' })).toBeVisible()
  await expect(page.getByText('Для открытия общей ссылки нужен интернет.')).toBeVisible()

  expect(await cachedUrls(page)).not.toEqual(
    expect.arrayContaining([expect.stringContaining('/api/')]),
  )
  expect(cspViolations).toEqual([])
})

async function cachedUrls(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      urls.push(...(await cache.keys()).map((request) => request.url))
    }
    return urls
  })
}
