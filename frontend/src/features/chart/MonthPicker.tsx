/**
 * Помесячная навигация графика: стрелка — подпись — стрелка, без карточки.
 * Шаг на месяц с переносом через год, clamp по текущему месяцу сверху и по
 * месяцу первой записи снизу.
 */

import { MONTH_NAMES } from '../../shared/constants'
import { ChartNavButton } from './ChartNav'

/** Месяц как пара «год + номер месяца 1..12». */
export interface YearMonth {
  year: number
  month: number
}

interface MonthPickerProps {
  year: number
  month: number
  /** Месяц первой записи; null — нижней границы пока нет. */
  minYear: number | null
  minMonth: number | null
  onChange: (year: number, month: number) => void
}

/** Текущий месяц: верхняя граница навигации и точка сброса. */
export function currentYearMonth(): YearMonth {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

/** Сравнение месяцев: < 0 — a раньше b, 0 — совпадают, > 0 — a позже b. */
function compareMonths(a: YearMonth, b: YearMonth): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month
}

/** Сдвиг на step месяцев с переносом через год. */
function shiftMonth({ year, month }: YearMonth, step: number): YearMonth {
  // Считаем в «абсолютных месяцах», чтобы не разбирать переход через декабрь вручную.
  const absolute = year * 12 + (month - 1) + step
  return { year: Math.floor(absolute / 12), month: (absolute % 12) + 1 }
}

/** Зажимает месяц в диапазон [min, текущий месяц]. */
export function clampMonth(value: YearMonth, min: YearMonth | null): YearMonth {
  const max = currentYearMonth()
  if (compareMonths(value, max) > 0) return max
  if (min && compareMonths(value, min) < 0) return min
  return value
}

export function MonthPicker({ year, month, minYear, minMonth, onChange }: MonthPickerProps) {
  const min = minYear !== null && minMonth !== null ? { year: minYear, month: minMonth } : null
  const value = { year, month }

  const atMin = min !== null && compareMonths(value, min) === 0
  const atMax = compareMonths(value, currentYearMonth()) === 0

  const step = (delta: number) => {
    const next = clampMonth(shiftMonth(value, delta), min)
    onChange(next.year, next.month)
  }

  return (
    <div className="chart-nav">
      <ChartNavButton
        direction={-1}
        label="Предыдущий месяц"
        disabled={atMin}
        onClick={() => step(-1)}
      />
      <span className="chart-nav-label">{`${MONTH_NAMES[month - 1]} ${year}`}</span>
      <ChartNavButton
        direction={1}
        label="Следующий месяц"
        disabled={atMax}
        onClick={() => step(1)}
      />
    </div>
  )
}
