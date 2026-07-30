/** Точка графика: одна запись с уже расшифрованной оценкой настроения. */
export interface ChartEntry {
  timestamp: string
  mood: number
}

export interface MoodChartProps {
  /** Отсортированы по времени по возрастанию, mood в диапазоне 1..9. */
  entries: ChartEntry[]
  /** Плавная кривая (безье) или ломаная — настройка «Плавный график». */
  smooth: boolean
  /** Режим месяца: подписи оси X по нечётным числам, иначе не более 6 подписей. */
  isMonthMode: boolean
}

/** Запись для блока статистики. anxiety учитывается только при showAnxiety. */
export interface StatsEntry {
  mood: number
  anxiety?: number
}

export interface ChartStatsProps {
  entries: StatsEntry[]
  /** Колонка «Тревога» есть только на странице врача. */
  showAnxiety: boolean
}
