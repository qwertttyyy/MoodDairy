/**
 * Тесты форматирования дат.
 *
 * Локале-зависимые строки (`toLocaleDateString('ru-RU', …)`) целиком не фиксируем:
 * их точный вид зависит от ICU-сборки Node. Проверяем устойчивые признаки —
 * номер дня, год, наличие названия месяца.
 */

import { describe, expect, it } from 'vitest'

import {
  dayLabel,
  dayLabelPlain,
  formatDateShort,
  formatTime,
  isoDateStr,
  isoTimeStr,
} from './dates'

/** Дата, сдвинутая на N дней от сегодняшней (сдвиг через setDate корректен на границах месяцев). */
function daysAgo(days: number): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - days)
  return d
}

describe('dayLabel', () => {
  it('называет сегодняшнюю дату «Сегодня»', () => {
    expect(dayLabel(isoDateStr(daysAgo(0)))).toBe('Сегодня')
  })

  it('называет вчерашнюю дату «Вчера»', () => {
    expect(dayLabel(isoDateStr(daysAgo(1)))).toBe('Вчера')
  })

  it('для более старой даты возвращает полную дату', () => {
    const old = daysAgo(10)
    const label = dayLabel(isoDateStr(old))

    expect(label).not.toBe('Сегодня')
    expect(label).not.toBe('Вчера')
    expect(label).toContain(String(old.getFullYear()))
    expect(label).toMatch(new RegExp(`\\b${old.getDate()}\\b`))
    expect(label).toMatch(/\p{L}/u)
  })

  it('для будущей даты не возвращает «Сегодня»/«Вчера»', () => {
    const label = dayLabel(isoDateStr(daysAgo(-3)))
    expect(label).not.toBe('Сегодня')
    expect(label).not.toBe('Вчера')
  })
})

describe('dayLabelPlain', () => {
  it('никогда не возвращает «Сегодня»/«Вчера»', () => {
    for (const shift of [0, 1, 2]) {
      const label = dayLabelPlain(isoDateStr(daysAgo(shift)))
      expect(label).not.toBe('Сегодня')
      expect(label).not.toBe('Вчера')
    }
  })

  it('содержит день и год', () => {
    const old = daysAgo(40)
    const label = dayLabelPlain(isoDateStr(old))
    expect(label).toContain(String(old.getFullYear()))
    expect(label).toMatch(new RegExp(`\\b${old.getDate()}\\b`))
  })

  it('совпадает с dayLabel для старых дат', () => {
    const iso = isoDateStr(daysAgo(30))
    expect(dayLabelPlain(iso)).toBe(dayLabel(iso))
  })
})

describe('isoDateStr', () => {
  it('дополняет месяц и день до двух цифр', () => {
    expect(isoDateStr(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('не портит двузначные значения', () => {
    expect(isoDateStr(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('берёт локальную дату, а не UTC (иначе вечерние записи уезжают на сутки)', () => {
    // 23:30 локального времени: toISOString в положительных таймзонах даст следующий день.
    expect(isoDateStr(new Date(2026, 5, 15, 23, 30))).toBe('2026-06-15')
  })
})

describe('isoTimeStr', () => {
  it('дополняет часы и минуты до двух цифр', () => {
    expect(isoTimeStr(new Date(2026, 0, 5, 7, 5))).toBe('07:05')
  })

  it('форматирует полночь и конец суток', () => {
    expect(isoTimeStr(new Date(2026, 0, 5, 0, 0))).toBe('00:00')
    expect(isoTimeStr(new Date(2026, 0, 5, 23, 59))).toBe('23:59')
  })
})

describe('formatTime', () => {
  it('показывает местное время из ISO-строки в формате HH:MM', () => {
    const d = new Date(2026, 2, 5, 9, 7)
    expect(formatTime(d.toISOString())).toMatch(/^09\D07$/)
  })

  it('не теряет ведущий ноль у полуночи', () => {
    const d = new Date(2026, 2, 5, 0, 4)
    expect(formatTime(d.toISOString())).toMatch(/^00\D04$/)
  })
})

describe('formatDateShort', () => {
  it('содержит номер дня и сокращённый месяц', () => {
    const d = new Date(2026, 2, 5, 12, 0)
    const label = formatDateShort(d.toISOString())

    expect(label).toMatch(/\b5\b/)
    expect(label).toMatch(/\p{L}/u)
    expect(label).not.toContain('2026')
  })
})
