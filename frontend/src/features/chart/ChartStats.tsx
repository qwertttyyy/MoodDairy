import { MAX_ANXIETY } from '../../shared/constants'
import type { ChartStatsProps, StatsEntry } from './types'

/** Одна плитка статистики: крупное значение и подпись под ним. */
interface StatTile {
  label: string
  value: string
}

const NO_VALUE = '—'

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Средняя тревога по записям, где она заполнена корректной оценкой 1..5. */
function anxietyAverage(entries: StatsEntry[]): string {
  const anxieties = entries
    .map((entry) => entry.anxiety)
    .filter((value): value is number => value !== undefined && value >= 1 && value <= MAX_ANXIETY)
  return anxieties.length ? average(anxieties).toFixed(1) : NO_VALUE
}

function buildTiles(entries: StatsEntry[], showAnxiety: boolean): StatTile[] {
  const moods = entries.map((entry) => entry.mood)
  const tiles: StatTile[] = [
    { label: 'Среднее', value: average(moods).toFixed(1) },
    { label: 'Макс', value: String(Math.max(...moods)) },
    { label: 'Мин', value: String(Math.min(...moods)) },
  ]
  if (showAnxiety) tiles.push({ label: 'Тревога', value: anxietyAverage(entries) })
  tiles.push({ label: 'Записей', value: String(entries.length) })
  return tiles
}

/** Блок статистики под графиком. Колонка «Тревога» — только на странице врача. */
export function ChartStats({ entries, showAnxiety }: ChartStatsProps) {
  // Без записей считать нечего: средние и минимумы дали бы NaN и Infinity.
  if (!entries.length) return null

  return (
    <div className="chart-stats">
      {buildTiles(entries, showAnxiety).map((tile) => (
        <div className="stat-item" key={tile.label}>
          <div className="stat-value">{tile.value}</div>
          <div className="stat-label">{tile.label}</div>
        </div>
      ))}
    </div>
  )
}
