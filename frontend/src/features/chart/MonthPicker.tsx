/**
 * Помесячная навигация графика.
 * Порт MonthPicker из backend/static/app.js (831-920): шаг на месяц с переносом
 * через год, clamp по текущему месяцу сверху и по месяцу первой записи снизу.
 */

import { MONTH_NAMES } from '../../shared/constants'

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

/** Текущий месяц: верхняя граница навигации и точка сброса (порт reset). */
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

/** Зажимает месяц в диапазон [min, текущий месяц]. Порт MonthPicker._clamp. */
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
    <div className="month-picker">
      <div className="month-picker-inner liquid-glass">
        <button
          className="month-nav-btn"
          aria-label="Предыдущий месяц"
          disabled={atMin}
          style={{ opacity: atMin ? '0.3' : '1' }}
          onClick={() => step(-1)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="month-label">{`${MONTH_NAMES[month - 1]} ${year}`}</span>
        <button
          className="month-nav-btn"
          aria-label="Следующий месяц"
          disabled={atMax}
          style={{ opacity: atMax ? '0.3' : '1' }}
          onClick={() => step(1)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  )
}
