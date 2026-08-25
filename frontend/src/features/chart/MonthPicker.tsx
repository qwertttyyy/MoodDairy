/**
 * Помесячная навигация графика: стрелка — подпись — стрелка, без карточки.
 * Шаг на месяц с переносом через год, clamp по текущему месяцу сверху и по
 * месяцу первой записи снизу.
 */

import { MONTH_NAMES } from '../../shared/constants'
import { ChartNavButton } from './ChartNav'
import { clampMonth, compareMonths, currentYearMonth, shiftMonth } from './pickerDates'

interface MonthPickerProps {
  year: number
  month: number
  /** Месяц первой записи; null — нижней границы пока нет. */
  minYear: number | null
  minMonth: number | null
  onChange: (year: number, month: number) => void
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
