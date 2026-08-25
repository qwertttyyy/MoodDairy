import { describe, expect, it } from 'vitest'

import { isoDateStr, localDateKey, localYearMonth } from './dates'

describe('локальные календарные даты', () => {
  it('не заменяет локальный календарный день UTC-датой', () => {
    expect(isoDateStr(new Date(2026, 5, 15, 23, 30))).toBe('2026-06-15')
  })

  it('относит один момент к правильному дню в разных timezone', () => {
    const instant = '2026-08-24T22:30:00Z'
    expect(localDateKey(instant, 'Europe/Moscow')).toBe('2026-08-25')
    expect(localDateKey(instant, 'America/Los_Angeles')).toBe('2026-08-24')
  })

  it('корректно переносит месяц и год около UTC-полуночи', () => {
    const instant = '2026-01-01T01:00:00Z'
    expect(localYearMonth(instant, 'Europe/Moscow')).toEqual({ year: 2026, month: 1 })
    expect(localYearMonth(instant, 'America/Los_Angeles')).toEqual({ year: 2025, month: 12 })
  })
})
