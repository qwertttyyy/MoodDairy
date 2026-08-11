/**
 * Погодовая навигация графика.
 *
 * Появилась вместо режима «всё время»: бэкенд требует период, чтобы одним
 * запросом нельзя было вытянуть всю историю, поэтому годы листаются так же,
 * как месяцы — от года первой записи до текущего.
 */

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
    <div className="month-picker">
      <div className="month-picker-inner liquid-glass">
        <button
          className="month-nav-btn"
          aria-label="Предыдущий год"
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
        <span className="month-label">{year}</span>
        <button
          className="month-nav-btn"
          aria-label="Следующий год"
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
