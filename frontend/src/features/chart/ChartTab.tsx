/**
 * Экран графика: выбор периода, сводка с трендом, графики настроения и
 * тревоги, карточка статистики.
 */

import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { useSettings } from '../../shared/settings/settings'
import { ChartIcon } from '../../shared/ui/EmptyStateIcons'
import { ErrorState } from '../../shared/ui/QueryState'
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
  const {
    data: dateRange,
    error: dateRangeError,
    isPending: isDateRangePending,
    refetch: refetchDateRange,
  } = useDateRange(active)

  const entries = useMemo(() => data?.entries ?? [], [data])
  const hasEntries = entries.length > 0
  // Пока первая загрузка не закончилась, решать нечем — пустое состояние не показываем.
  const loading = isPending || isDateRangePending
  const failed = error || dateRangeError
  const showEmpty = !loading && !failed && !hasEntries

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

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    let nextIndex = index
    if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = CHART_MODES.length - 1
    else
      nextIndex =
        (index + (event.key === 'ArrowRight' ? 1 : -1) + CHART_MODES.length) % CHART_MODES.length

    const next = CHART_MODES[nextIndex]
    if (!next) return
    selectMode(next.value)
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(nextIndex)
      .focus()
  }

  return (
    <>
      <div className="chart-seg" role="tablist" aria-label="Период графика">
        {CHART_MODES.map((item, index) => (
          <button
            type="button"
            key={item.value}
            id={`chart-period-tab-${item.value}`}
            role="tab"
            aria-selected={item.value === mode}
            aria-controls="chart-period-panel"
            tabIndex={item.value === mode ? 0 : -1}
            className={item.value === mode ? 'chart-seg-btn active' : 'chart-seg-btn'}
            onClick={() => selectMode(item.value)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id="chart-period-panel" role="tabpanel" aria-labelledby={`chart-period-tab-${mode}`}>
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

        {failed ? (
          <ErrorState
            message="Не удалось загрузить данные графика"
            onRetry={() => {
              void refetch()
              void refetchDateRange()
            }}
          />
        ) : null}

        {!failed && loading ? <ChartSkeleton /> : null}

        {!loading && !failed && hasEntries && (
          <>
            {(data?.corruptedCount ?? 0) > 0 ? (
              <p className="chart-warning" role="status">
                Не удалось расшифровать записей: {data?.corruptedCount ?? 0}. Они не показаны на
                графике.
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
      </div>
    </>
  )
}

export default ChartTab

function SectionHead({ title, scale }: { title: string; scale: string }) {
  return (
    <div className="chart-sechead">
      <h2 className="chart-sechead-title">{title}</h2>
      <span className="chart-sechead-scale">{scale}</span>
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="chart-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Загружаем график…</span>
      <span className="chart-skeleton-summary" aria-hidden="true" />
      <span className="chart-skeleton-line" aria-hidden="true" />
      <span className="chart-skeleton-plot chart-skeleton-plot-main" aria-hidden="true" />
      <span className="chart-skeleton-line" aria-hidden="true" />
      <span className="chart-skeleton-plot chart-skeleton-plot-small" aria-hidden="true" />
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
