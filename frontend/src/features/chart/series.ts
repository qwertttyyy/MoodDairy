/**
 * Календарный ряд для графика.
 *
 * Ось X у графика календарная: точка стоит на своей дате, а не на «номере
 * записи по порядку». Поэтому из записей строится ряд «по одному элементу на
 * каждый день периода»: значение — среднее за день, null — записей не было.
 */

import { MAX_ANXIETY, MAX_MOOD } from '../../shared/constants'
import { isoDateStr } from '../../shared/lib/dates'
import type { ChartEntry, DayPoint, DayRange } from './types'

/** Локальная полночь указанной даты. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const shifted = startOfDay(date)
  shifted.setDate(shifted.getDate() + days)
  return shifted
}

export function today(): Date {
  return startOfDay(new Date())
}

/** Сумма и количество оценок одного дня — из них получается среднее. */
interface DayAccumulator {
  moodSum: number
  moodCount: number
  anxietySum: number
  anxietyCount: number
}

function emptyAccumulator(): DayAccumulator {
  return { moodSum: 0, moodCount: 0, anxietySum: 0, anxietyCount: 0 }
}

function isValid(value: number | undefined, max: number): value is number {
  return value !== undefined && value >= 1 && value <= max
}

/**
 * Ряд из одного элемента на каждый день периода.
 * Дни без записей остаются с null — именно они дают разрыв линии.
 */
export function buildDailySeries(entries: ChartEntry[], range: DayRange): DayPoint[] {
  const from = startOfDay(range.from)
  const to = startOfDay(range.to)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return []

  const byDay = new Map<string, DayAccumulator>()
  for (const entry of entries) {
    const date = new Date(entry.timestamp)
    if (Number.isNaN(date.getTime())) continue
    const key = isoDateStr(date)
    const acc = byDay.get(key) ?? emptyAccumulator()
    if (isValid(entry.mood, MAX_MOOD)) {
      acc.moodSum += entry.mood
      acc.moodCount++
    }
    if (isValid(entry.anxiety, MAX_ANXIETY)) {
      acc.anxietySum += entry.anxiety
      acc.anxietyCount++
    }
    byDay.set(key, acc)
  }

  const rows: DayPoint[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const acc = byDay.get(isoDateStr(date))
    rows.push({
      date,
      mood: acc && acc.moodCount ? acc.moodSum / acc.moodCount : null,
      anxiety: acc && acc.anxietyCount ? acc.anxietySum / acc.anxietyCount : null,
    })
  }
  return rows
}

/** Границы периода по самим записям — запасной вариант, когда period не задан. */
export function rangeOfEntries(entries: ChartEntry[], wholeMonth: boolean): DayRange {
  if (!entries.length) {
    const now = today()
    return { from: now, to: now }
  }
  const dates = entries.map((entry) => startOfDay(new Date(entry.timestamp)))
  const from = dates.reduce((min, date) => (date < min ? date : min), dates[0])
  const to = dates.reduce((max, date) => (date > max ? date : max), dates[0])
  if (!wholeMonth) return { from, to }
  // Месяц показываем целиком: ось не сжимается к дням, где есть записи.
  return {
    from: new Date(from.getFullYear(), from.getMonth(), 1),
    to: new Date(from.getFullYear(), from.getMonth() + 1, 0),
  }
}

/** Среднее настроение по записям; null — считать нечего. */
export function averageMood(entries: ChartEntry[]): number | null {
  const moods = entries.map((entry) => entry.mood).filter((mood) => isValid(mood, MAX_MOOD))
  if (!moods.length) return null
  return moods.reduce((sum, mood) => sum + mood, 0) / moods.length
}

/** Записи, попавшие в отрезок дней (обе границы включительно). */
export function filterByRange(entries: ChartEntry[], range: DayRange): ChartEntry[] {
  const from = startOfDay(range.from).getTime()
  const to = addDays(range.to, 1).getTime()
  return entries.filter((entry) => {
    const time = new Date(entry.timestamp).getTime()
    return time >= from && time < to
  })
}
