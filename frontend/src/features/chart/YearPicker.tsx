/**
 * Погодовая навигация графика.
 *
 * Появилась вместо режима «всё время»: бэкенд требует период, чтобы одним
 * запросом нельзя было вытянуть всю историю, поэтому годы листаются так же,
 * как месяцы — от года первой записи до текущего.
 */

import { ChartNavButton } from './ChartNav'

interface YearPickerProps {
  year: number
  /** Год первой записи; null — нижней границы пока нет. */
  minYear: number | null
  onChange: (year: number) => void
}

export function currentYear(): number {
  return new Date().getFullYear()
}

/** Зажимает год в диапазон [minYear, текущий год]. */
export function clampYear(value: number, minYear: number | null): number {
  const max = currentYear()
  if (value > max) return max
  if (minYear !== null && value < minYear) return minYear
  return value
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
      <ChartNavButton direction={1} label="Следующий год" disabled={atMax} onClick={() => step(1)} />
    </div>
  )
}
