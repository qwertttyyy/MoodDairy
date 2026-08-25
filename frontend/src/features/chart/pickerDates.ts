import { localYearMonth } from '../../shared/lib/dates'

export interface YearMonth {
  year: number
  month: number
}

export function currentYearMonth(): YearMonth {
  return localYearMonth(new Date())
}

export function compareMonths(a: YearMonth, b: YearMonth): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month
}

export function shiftMonth({ year, month }: YearMonth, step: number): YearMonth {
  const absolute = year * 12 + (month - 1) + step
  return { year: Math.floor(absolute / 12), month: (absolute % 12) + 1 }
}

export function clampMonth(value: YearMonth, min: YearMonth | null): YearMonth {
  const max = currentYearMonth()
  if (compareMonths(value, max) > 0) return max
  if (min && compareMonths(value, min) < 0) return min
  return value
}

export function currentYear(): number {
  return localYearMonth(new Date()).year
}

export function clampYear(value: number, minYear: number | null): number {
  const max = currentYear()
  if (value > max) return max
  if (minYear !== null && value < minYear) return minYear
  return value
}
