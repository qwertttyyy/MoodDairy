import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

export async function expectNoSeriousAxeViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa'])
  if (include) builder = builder.include(include)
  const results = await builder.analyze()
  expect(
    results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'),
  ).toEqual([])
}

export async function mockAuthenticatedApi(page: Page, withEntry = false) {
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
