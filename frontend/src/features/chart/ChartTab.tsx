/**
 * Экран графика: выбор периода, сводка с трендом, графики настроения и
 * тревоги, карточка статистики.
 */

import { useMemo, useState } from 'react'

import { useSettings } from '../../shared/settings/settings'
import { ChartIcon } from '../../shared/ui/EmptyStateIcons'
import { ErrorState, LoadingState } from '../../shared/ui/QueryState'
import { useChartEntries, useDateRange } from '../entries/api'
import { ChartStats } from './ChartStats'
import { MoodChart } from './MoodChart'
import { MonthPicker } from './MonthPicker'
import { CHART_MODES, parseFirstMonth, periodView } from './period'
import type { ChartMode } from './period'
import { clampYear, currentYear, currentYearMonth } from './pickerDates'
import type { YearMonth } from './pickerDates'
import { averageMood, filterByRange } from './series'
import type { ChartEntry, DayRange } from './types'
import { YearPicker } from './YearPicker'

export function ChartTab({ active }: { active: boolean }) {
  const { settings } = useSettings()
  const [mode, setMode] = useState<ChartMode>('month')
  const [selectedMonth, setSelectedMonth] = useState<YearMonth>(currentYearMonth)
  const [selectedYear, setSelectedYear] = useState<number>(currentYear)

  const isMonthMode = mode === 'month'
  const isYearMode = mode === 'year'
  const period = useMemo(
    () => periodView(mode, selectedMonth, selectedYear),
    [mode, selectedMonth, selectedYear],
  )

  // Запросы уходят только на открытом табе: скрытому графику данные не нужны.
  const { data, error, isPending, refetch } = useChartEntries(period.query, active)
  const { data: previousData } = useChartEntries(period.previous.query, active)
  const { data: dateRange, error: dateRangeError, refetch: refetchDateRange } = useDateRange(active)

  const entries = useMemo(() => data?.entries ?? [], [data])
  const hasEntries = entries.length > 0
  // Пока первая загрузка не закончилась, решать нечем — пустое состояние не показываем.
  const showEmpty = !isPending && !hasEntries

  const average = averageMood(entries)
  const trend = useMemo(
    () => moodTrend(average, previousData?.entries ?? [], period.previous.range),
    [average, previousData, period.previous.range],
  )

  const firstMonth = parseFirstMonth(dateRange?.first_date ?? null)

  const selectMode = (next: ChartMode) => {
    setMode(next)
    // Вход в календарный режим начинается с текущего месяца или года,
    // а не с того, на котором остановились в прошлый раз.
    if (next === 'month') setSelectedMonth(currentYearMonth())
    if (next === 'year') setSelectedYear(clampYear(currentYear(), firstMonth?.year ?? null))
  }

  if (isPending) return <LoadingState label="Загружаем график…" />
  if (error || dateRangeError) {
    return (
      <ErrorState
        message="Не удалось загрузить данные графика"
        onRetry={() => {
          void refetch()
          void refetchDateRange()
        }}
      />
    )
  }

  return (
    <>
      <div className="chart-seg" role="tablist">
        {CHART_MODES.map((item) => (
          <button
            key={item.value}
            role="tab"
            aria-selected={item.value === mode}
            className={item.value === mode ? 'chart-seg-btn active' : 'chart-seg-btn'}
            onClick={() => selectMode(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {isMonthMode && (
        <MonthPicker
          year={selectedMonth.year}
          month={selectedMonth.month}
          minYear={firstMonth?.year ?? null}
          minMonth={firstMonth?.month ?? null}
          onChange={(year, month) => setSelectedMonth({ year, month })}
        />
      )}

      {isYearMode && (
        <YearPicker
          year={selectedYear}
          minYear={firstMonth?.year ?? null}
          onChange={setSelectedYear}
        />
      )}

      {hasEntries && (
        <>
          {data.corruptedCount > 0 ? (
            <p className="chart-warning" role="status">
              Не удалось расшифровать записей: {data.corruptedCount}. Они не показаны на графике.
            </p>
          ) : null}
          <div className="chart-summary">
            <div>
              <div className="chart-avg">{average === null ? '—' : average.toFixed(1)}</div>
              <div className="chart-caption">{period.caption}</div>
            </div>
            {trend !== null && <TrendBadge delta={trend} />}
          </div>

          <SectionHead title="Настроение" scale="шкала 1–9" />
          <MoodChart entries={entries} smooth={settings.chartSmooth} range={period.range} />

          <SectionHead title="Тревога" scale="шкала 1–5" />
          <MoodChart
            entries={entries}
            smooth={settings.chartSmooth}
            kind="anxiety"
            range={period.range}
          />

          <ChartStats entries={entries} showAnxiety />
        </>
      )}

      {showEmpty && (
        <div className="empty-state">
          <div className="empty-icon">
            <ChartIcon />
          </div>
          <p className="empty-title">Нет данных</p>
          <p className="empty-sub">Добавь запись, чтобы увидеть график</p>
        </div>
      )}
    </>
  )
}

function SectionHead({ title, scale }: { title: string; scale: string }) {
  return (
    <div className="chart-sechead">
      <span className="chart-sechead-title">{title}</span>
      <span className="chart-sechead-scale">{scale}</span>
    </div>
  )
}

/**
 * Разница среднего настроения с предыдущим таким же периодом.
 * null — сравнивать не с чем либо разница неразличима после округления.
 */
function moodTrend(
  average: number | null,
  previousEntries: ChartEntry[],
  range: DayRange,
): number | null {
  if (average === null) return null
  const previousAverage = averageMood(filterByRange(previousEntries, range))
  if (previousAverage === null) return null
  const delta = average - previousAverage
  return Math.abs(delta) < 0.05 ? null : delta
}

/** Капсула тренда: стрелка направления и значение вида «+0.4». */
function TrendBadge({ delta }: { delta: number }) {
  const up = delta > 0
  return (
    <div className="chart-trend">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {up ? (
          <>
            <path d="M12 19V5" />
            <path d="M5.5 11.5 12 5l6.5 6.5" />
          </>
        ) : (
          <>
            <path d="M12 5v14" />
            <path d="M18.5 12.5 12 19l-6.5-6.5" />
          </>
        )}
      </svg>
      {`${up ? '+' : '−'}${Math.abs(delta).toFixed(1)}`}
    </div>
  )
}
