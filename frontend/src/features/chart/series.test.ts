/**
 * Тесты календарного ряда и границ периодов.
 *
 * Ось X у графика календарная: точка стоит на своей дате. Раньше даты
 * «съезжали», потому что ряд строился по номеру записи, — поэтому форма ряда
 * здесь часть контракта, а не деталь реализации.
 */

import { describe, expect, it } from 'vitest'

import { periodView } from './period'
import { averageMood, buildDailySeries, filterByRange } from './series'
import type { ChartEntry } from './types'

/** Запись в локальном времени: график группирует дни по календарю пользователя. */
function entry(day: number, mood: number, anxiety?: number): ChartEntry {
  return {
    timestamp: new Date(2026, 2, day, 12, 0, 0).toISOString(),
    mood,
    anxiety,
  }
}

const MARCH = { from: new Date(2026, 2, 1), to: new Date(2026, 2, 5) }

describe('buildDailySeries', () => {
  it('даёт по одному элементу на каждый день периода', () => {
    const rows = buildDailySeries([entry(2, 5)], MARCH)

    expect(rows).toHaveLength(5)
    expect(rows.map((row) => row.date.getDate())).toEqual([1, 2, 3, 4, 5])
  })

  it('день без записей остаётся пустым — это разрыв линии, а не соединение', () => {
    const rows = buildDailySeries([entry(1, 4), entry(4, 8)], MARCH)

    expect(rows.map((row) => row.mood)).toEqual([4, null, null, 8, null])
  })

  it('несколько записей за день усредняются', () => {
    const rows = buildDailySeries([entry(1, 4), entry(1, 7)], MARCH)

    expect(rows[0].mood).toBe(5.5)
  })

  it('тревога считается отдельно от настроения и только по заполненным оценкам', () => {
    const rows = buildDailySeries([entry(1, 4, 2), entry(1, 6)], MARCH)

    expect(rows[0].mood).toBe(5)
    expect(rows[0].anxiety).toBe(2)
  })

  it('оценки вне шкалы не попадают в ряд', () => {
    const rows = buildDailySeries([entry(1, 0), entry(1, 12, 9)], MARCH)

    expect(rows[0].mood).toBeNull()
    expect(rows[0].anxiety).toBeNull()
  })

  it('границы берутся из периода, а не из записей', () => {
    const rows = buildDailySeries([entry(3, 5)], MARCH)

    expect(rows[0].date.getDate()).toBe(1)
    expect(rows[rows.length - 1].date.getDate()).toBe(5)
  })
})

describe('averageMood', () => {
  it('без записей считать нечего', () => {
    expect(averageMood([])).toBeNull()
  })

  it('усредняет оценки в пределах шкалы', () => {
    expect(averageMood([entry(1, 4), entry(2, 6)])).toBe(5)
  })
})

describe('filterByRange', () => {
  it('обе границы отрезка входят в выборку', () => {
    const entries = [entry(1, 5), entry(5, 5), entry(6, 5)]

    expect(filterByRange(entries, MARCH)).toHaveLength(2)
  })
})

describe('periodView', () => {
  it('месяц показывается целиком, а сравнивается с предыдущим месяцем', () => {
    const view = periodView('month', { year: 2025, month: 3 }, 2025)

    expect(view.range.from.getDate()).toBe(1)
    expect(view.range.to.getDate()).toBe(31)
    expect(view.previous.query).toEqual({ kind: 'month', year: 2025, month: 2 })
    expect(view.previous.range.to.getDate()).toBe(28)
  })

  it('январь сравнивается с декабрём прошлого года', () => {
    const view = periodView('month', { year: 2025, month: 1 }, 2025)

    expect(view.previous.query).toEqual({ kind: 'month', year: 2024, month: 12 })
  })

  it('год сравнивается с предыдущим годом', () => {
    const view = periodView('year', { year: 2025, month: 1 }, 2025)

    expect(view.query).toEqual({ kind: 'year', year: 2025 })
    expect(view.previous.query).toEqual({ kind: 'year', year: 2024 })
  })

  it('две недели: окно из 14 дней и такое же окно перед ним', () => {
    const view = periodView('2weeks', { year: 2026, month: 8 }, 2026)

    expect(days(view.range)).toBe(14)
    expect(days(view.previous.range)).toBe(14)
    // Предыдущие две недели отдельным запросом не получить — берём месяц.
    expect(view.previous.query).toEqual({ kind: 'period', period: 'month' })
    expect(view.previous.range.to.getTime()).toBeLessThan(view.range.from.getTime())
  })

  it('полгода сравниваются с предыдущим полугодием из годового запроса', () => {
    const view = periodView('6months', { year: 2026, month: 8 }, 2026)

    expect(days(view.range)).toBe(182)
    expect(days(view.previous.range)).toBe(182)
    expect(view.previous.query).toEqual({ kind: 'period', period: 'year' })
  })
})

/** Длина отрезка в днях, включая обе границы. */
function days(range: { from: Date; to: Date }): number {
  return Math.round((range.to.getTime() - range.from.getTime()) / 864e5) + 1
}
