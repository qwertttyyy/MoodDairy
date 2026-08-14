/** Карточка-группа со сводкой за период: строки «подпись — значение». */

import { Fragment } from 'react'

import { MAX_ANXIETY } from '../../shared/constants'
import type { ChartStatsProps, StatsEntry } from './types'

/** Одна строка карточки. */
interface StatRow {
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

function buildRows(entries: StatsEntry[], showAnxiety: boolean): StatRow[] {
  const moods = entries.map((entry) => entry.mood)
  const rows: StatRow[] = [
    { label: 'Среднее настроение', value: average(moods).toFixed(1) },
    { label: 'Мин / макс', value: `${Math.min(...moods)} / ${Math.max(...moods)}` },
  ]
  if (showAnxiety) rows.push({ label: 'Средняя тревога', value: anxietyAverage(entries) })
  rows.push({ label: 'Записей', value: String(entries.length) })
  return rows
}

export function ChartStats({ entries, showAnxiety }: ChartStatsProps) {
  // Без записей считать нечего: средние и минимумы дали бы NaN и Infinity.
  if (!entries.length) return null

  const rows = buildRows(entries, showAnxiety)

  return (
    <div className="stats-card">
      {rows.map((row, index) => (
        <Fragment key={row.label}>
          {index > 0 && <div className="stats-sep" />}
          <div className="stats-row">
            <span className="stats-key">{row.label}</span>
            <span className="stats-value">{row.value}</span>
          </div>
        </Fragment>
      ))}
    </div>
  )
}
