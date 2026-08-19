/** Точка графика: одна запись с уже расшифрованными оценками. */
export interface ChartEntry {
  timestamp: string
  mood: number
  /** Тревога 1..5; 0 — оценка не заполнена. */
  anxiety?: number
}

/** Отрезок дней, включая обе границы. Обе даты — локальная полночь. */
export interface DayRange {
  from: Date
  to: Date
}

/**
 * Один день календарного ряда.
 * null означает, что в этот день записей не было. Линия соединяет ближайшие
 * известные значения, сохраняя расстояние между их датами.
 */
export interface DayPoint {
  date: Date
  mood: number | null
  anxiety: number | null
}

/** Какую шкалу рисуем: настроение 1..9 или тревогу 1..5. */
export type ChartKind = 'mood' | 'anxiety'

export interface MoodChartProps {
  /** Отсортированы по времени по возрастанию, mood в диапазоне 1..9. */
  entries: ChartEntry[]
  /** Плавная кривая (безье) или ломаная — настройка «Плавный график». */
  smooth: boolean
  /** Шкала графика; по умолчанию настроение. */
  kind?: ChartKind
  /**
   * Границы периода. Задаются явно, чтобы ось X показывала весь выбранный
   * отрезок, а не расстояние между первой и последней записью.
   */
  range?: DayRange
  /** Без явного range расширяет ось до календарного месяца записей. */
  isMonthMode?: boolean
}

/** Запись для блока статистики. anxiety учитывается только при showAnxiety. */
export interface StatsEntry {
  mood: number
  anxiety?: number
}

export interface ChartStatsProps {
  entries: StatsEntry[]
  /** Строка «Средняя тревога» — на экране графика и на странице врача. */
  showAnxiety: boolean
}
