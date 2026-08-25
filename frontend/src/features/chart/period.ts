/**
 * Периоды экрана графика: что запрашивать, какой отрезок дней показывать на
 * оси X и с чем сравнивать ради тренда.
 *
 * Границы берутся из выбранного режима, а не из первой и последней записи:
 * иначе месяц с двумя записями растянулся бы на всю ширину холста.
 */

import { MONTH_NAMES } from '../../shared/constants'
import type { ChartQuery } from '../entries/api'
import { addDays, startOfDay, today } from './series'
import type { DayRange } from './types'

/**
 * Режим графика. `year` и `month` — календарные, с навигацией по стрелкам;
 * остальные — относительные отрезки от текущего момента.
 */
export type ChartMode = 'year' | '6months' | 'month' | '2weeks'

export const CHART_MODES: ReadonlyArray<{ value: ChartMode; label: string }> = [
  { value: 'year', label: 'Год' },
  { value: '6months', label: '6 мес' },
  { value: 'month', label: 'Месяц' },
  { value: '2weeks', label: '2 нед' },
]

const DAYS_IN_2WEEKS = 14
const DAYS_IN_6MONTHS = 182

/** Всё, что экран знает о выбранном периоде. */
export interface PeriodView {
  query: ChartQuery
  /** Отрезок дней на оси X. */
  range: DayRange
  /** Подпись под средним значением. */
  caption: string
  /**
   * Предыдущий такой же период — для тренда.
   *
   * Относительный отрезок отдельным запросом не получить: бэкенд знает только
   * «последние N дней от сейчас». Поэтому запрашивается ближайший период
   * подлиннее, а нужное окно вырезается из ответа.
   */
  previous: { query: ChartQuery; range: DayRange }
}

/** Последний день месяца (нулевой день следующего). */
function lastDayOfMonth(year: number, month: number): Date {
  return new Date(year, month, 0)
}

/** Будущего в данных нет: календарный период обрывается сегодняшним днём. */
function clampToToday(date: Date): Date {
  const now = today()
  return date > now ? now : date
}

function monthView(year: number, month: number): PeriodView {
  const previousMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  return {
    query: { kind: 'month', year, month },
    range: {
      from: new Date(year, month - 1, 1),
      to: clampToToday(lastDayOfMonth(year, month)),
    },
    caption: `${(MONTH_NAMES[month - 1] ?? '').toLowerCase()} ${year}`,
    previous: {
      query: { kind: 'month', ...previousMonth },
      range: {
        from: new Date(previousMonth.year, previousMonth.month - 1, 1),
        to: lastDayOfMonth(previousMonth.year, previousMonth.month),
      },
    },
  }
}

function yearView(year: number): PeriodView {
  return {
    query: { kind: 'year', year },
    range: { from: new Date(year, 0, 1), to: clampToToday(new Date(year, 11, 31)) },
    caption: `${year} год`,
    previous: {
      query: { kind: 'year', year: year - 1 },
      range: { from: new Date(year - 1, 0, 1), to: new Date(year - 1, 11, 31) },
    },
  }
}

/** Относительный отрезок в `days` дней, заканчивающийся сегодня. */
function relativeView(
  period: '2weeks' | '6months',
  days: number,
  caption: string,
  previousQuery: ChartQuery,
): PeriodView {
  const end = today()
  const start = addDays(end, -(days - 1))
  return {
    query: { kind: 'period', period },
    range: { from: start, to: end },
    caption,
    previous: {
      query: previousQuery,
      range: { from: addDays(start, -days), to: addDays(start, -1) },
    },
  }
}

/**
 * Описание выбранного периода.
 * Календарные режимы берут свою половину состояния: месяц — `selectedMonth`,
 * год — `selectedYear`.
 */
export function periodView(
  mode: ChartMode,
  selectedMonth: { year: number; month: number },
  selectedYear: number,
): PeriodView {
  switch (mode) {
    case 'month':
      return monthView(selectedMonth.year, selectedMonth.month)
    case 'year':
      return yearView(selectedYear)
    case '2weeks':
      // Предыдущие две недели входят в «последний месяц» — 30 дней от сейчас.
      return relativeView(mode, DAYS_IN_2WEEKS, 'последние 2 недели', {
        kind: 'period',
        period: 'month',
      })
    default:
      // Предыдущие полгода входят в «последний год» — 365 дней от сейчас.
      return relativeView('6months', DAYS_IN_6MONTHS, 'последние 6 месяцев', {
        kind: 'period',
        period: 'year',
      })
  }
}

/** Дата первой записи → месяц нижней границы навигации. */
export function parseFirstMonth(firstDate: string | null): { year: number; month: number } | null {
  if (!firstDate) return null
  const date = new Date(firstDate)
  if (Number.isNaN(date.getTime())) return null
  const local = startOfDay(date)
  return { year: local.getFullYear(), month: local.getMonth() + 1 }
}
