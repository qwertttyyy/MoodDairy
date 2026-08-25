/**
 * Тесты построения URL графика.
 *
 * Период в запросе обязателен: бэкенд отвечает 400, если его нет, — так одним
 * запросом нельзя вытянуть всю историю. Поэтому форма URL здесь часть
 * контракта, а не деталь реализации.
 */

import { afterEach, describe, expect, it } from 'vitest'

import type { RawEntry } from '../../shared/api/types'
import { setEncryptionEnabled } from '../../shared/crypto/crypto'
import { buildChartUrl, decryptEntries } from './api'

afterEach(() => setEncryptionEnabled(true))

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

describe('частично повреждённый набор записей', () => {
  it('не скрывает корректные записи из-за одной повреждённой', async () => {
    setEncryptionEnabled(false)
    const base = { note: 'Текст', anxiety: '2', tags: [], timestamp: '2026-08-24T20:00:00Z' }
    const raw: RawEntry[] = [
      { ...base, id: 1, mood: '7' },
      { ...base, id: 2, mood: 'не число', note: 'Скрытый текст' },
    ]

    const entries = await decryptEntries(raw)

    expect(entries[0]).toMatchObject({ kind: 'ready', id: 1, mood: 7, note: 'Текст' })
    expect(entries[1]).toEqual({ kind: 'corrupted', id: 2, timestamp: base.timestamp })
    expect(JSON.stringify(entries[1])).not.toContain('Скрытый текст')
  })
})
