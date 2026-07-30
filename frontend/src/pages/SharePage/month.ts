/**
 * Навигация по месяцам на странице врача.
 *
 * Порт функций changeMonth / clampMonth / getMonthEntries из backend/static/share.js.
 * Всё — чистые функции: на вход месяц и границы, на выход новый месяц.
 */

/** Месяц снапшота. `month` — 1..12, чтобы обращаться к MONTH_NAMES[month - 1]. */
export interface YearMonth {
  year: number
  month: number
}

/** Границы навигации: от первой записи снапшота до последней. */
export interface MonthBounds {
  min: YearMonth
  max: YearMonth
}

/** Минимум, который нужен от записи для расчёта границ. */
interface Timestamped {
  timestamp: string
}

/** Порядок месяцев: <0 — `a` раньше `b`, 0 — совпадают, >0 — `a` позже `b`. */
export function compareMonths(a: YearMonth, b: YearMonth): number {
  return a.year === b.year ? a.month - b.month : a.year - b.year
}

/** Месяц метки времени по локальному времени браузера — как `new Date(...)` в share.js. */
export function monthOf(timestamp: string): YearMonth {
  const date = new Date(timestamp)
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

/**
 * Границы снапшота. Записи должны быть отсортированы по времени по возрастанию.
 * Пустой снапшот сводит обе границы к текущему месяцу.
 */
export function getMonthBounds(entries: readonly Timestamped[]): MonthBounds {
  if (entries.length === 0) {
    const now = new Date()
    const current: YearMonth = { year: now.getFullYear(), month: now.getMonth() + 1 }
    return { min: current, max: current }
  }
  return {
    min: monthOf(entries[0].timestamp),
    max: monthOf(entries[entries.length - 1].timestamp),
  }
}

/** Сдвиг на месяц назад (-1) или вперёд (+1) с переносом через год. */
export function shiftMonth(current: YearMonth, direction: 1 | -1): YearMonth {
  const month = current.month + direction
  if (month > 12) return { year: current.year + 1, month: 1 }
  if (month < 1) return { year: current.year - 1, month: 12 }
  return { year: current.year, month }
}

/** Прижимает месяц к границам снапшота. */
export function clampMonth(target: YearMonth, bounds: MonthBounds): YearMonth {
  if (compareMonths(target, bounds.min) < 0) return bounds.min
  if (compareMonths(target, bounds.max) > 0) return bounds.max
  return target
}
