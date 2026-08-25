/**
 * Тесты построения URL графика.
 *
 * Период в запросе обязателен: бэкенд отвечает 400, если его нет, — так одним
 * запросом нельзя вытянуть всю историю. Поэтому форма URL здесь часть
 * контракта, а не деталь реализации.
 */

import { describe, expect, it } from 'vitest'

import { buildChartUrl } from './api'

describe('buildChartUrl', () => {
  it('относительный период уходит параметром period', () => {
    expect(buildChartUrl({ kind: 'period', period: '2weeks' })).toBe('/api/entries/?period=2weeks')
    expect(buildChartUrl({ kind: 'period', period: '6months' })).toBe(
      '/api/entries/?period=6months',
    )
  })

  it('календарный год уходит параметром year', () => {
    expect(buildChartUrl({ kind: 'year', year: 2025 })).toBe('/api/entries/?year=2025')
  })

  it('календарный месяц уходит парой year и month', () => {
    expect(buildChartUrl({ kind: 'month', year: 2026, month: 3 })).toBe(
      '/api/entries/?year=2026&month=3',
    )
  })

  it('всегда содержит период — иначе бэкенд ответит 400', () => {
    const urls = [
      buildChartUrl({ kind: 'period', period: '2weeks' }),
      buildChartUrl({ kind: 'year', year: 2025 }),
      buildChartUrl({ kind: 'month', year: 2025, month: 12 }),
    ]

    for (const url of urls) {
      expect(url).toMatch(/[?&](period|year)=/)
    }
  })
})
