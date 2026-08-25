/**
 * Погодовая навигация графика.
 *
 * Появилась вместо режима «всё время»: бэкенд требует период, чтобы одним
 * запросом нельзя было вытянуть всю историю, поэтому годы листаются так же,
 * как месяцы — от года первой записи до текущего.
 */

import { ChartNavButton } from './ChartNav'
import { clampYear, currentYear } from './pickerDates'

interface YearPickerProps {
  year: number
  /** Год первой записи; null — нижней границы пока нет. */
  minYear: number | null
  onChange: (year: number) => void
}

export function YearPicker({ year, minYear, onChange }: YearPickerProps) {
  const atMin = minYear !== null && year <= minYear
  const atMax = year >= currentYear()

  const step = (delta: number) => onChange(clampYear(year + delta, minYear))

  return (
    <div className="chart-nav">
      <ChartNavButton
        direction={-1}
        label="Предыдущий год"
        disabled={atMin}
        onClick={() => step(-1)}
      />
      <span className="chart-nav-label">{year}</span>
      <ChartNavButton
        direction={1}
        label="Следующий год"
        disabled={atMax}
        onClick={() => step(1)}
      />
    </div>
  )
}
