/**
 * Таб графика: сегмент-контрол периодов, помесячная навигация, график и статистика.
 * Порт Chart (backend/static/app.js:926-992) и относящейся к табу части TabNav.switchTo.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { useSettings } from '../../shared/settings/SettingsProvider'
import { useChartEntries, useDateRange } from '../entries/api'
import type { ChartQuery } from '../entries/api'
import { ChartStats } from './ChartStats'
import { MoodChart } from './MoodChart'
import { MonthPicker, currentYearMonth } from './MonthPicker'
import type { YearMonth } from './MonthPicker'
import { YearPicker, clampYear, currentYear } from './YearPicker'

/**
 * Режим графика. `year` и `month` — календарные, с навигацией по стрелкам;
 * остальные — относительные отрезки от текущего момента.
 *
 * Режим «всё время» убран: бэкенд требует период, чтобы одним запросом нельзя
 * было получить всю историю. Прошлые годы доступны через переключение года.
 */
type ChartMode = 'year' | '6months' | 'month' | '2weeks'

const MODES: ReadonlyArray<{ value: ChartMode; label: string }> = [
  { value: 'year', label: 'Год' },
  { value: '6months', label: '6 мес' },
  { value: 'month', label: 'Месяц' },
  { value: '2weeks', label: '2 нед' },
]

const RESIZE_DEBOUNCE_MS = 150

export function ChartTab({ active }: { active: boolean }) {
  const { settings } = useSettings()
  const [mode, setMode] = useState<ChartMode>('month')
  const [selectedMonth, setSelectedMonth] = useState<YearMonth>(currentYearMonth)
  const [selectedYear, setSelectedYear] = useState<number>(currentYear)

  const isMonthMode = mode === 'month'
  const isYearMode = mode === 'year'
  const query: ChartQuery = isMonthMode
    ? { kind: 'month', year: selectedMonth.year, month: selectedMonth.month }
    : isYearMode
      ? { kind: 'year', year: selectedYear }
      : { kind: 'period', period: mode }

  // Запросы уходят только на открытом табе — как в switchTo, где загрузка шла по переходу.
  const { data, isPending } = useChartEntries(query, active)
  const { data: dateRange } = useDateRange(active)

  const entries = data ?? []
  const hasEntries = entries.length > 0
  // Пока первая загрузка не закончилась, решать нечем — пустое состояние не показываем.
  const showEmpty = !isPending && !hasEntries

  const firstMonth = parseFirstMonth(dateRange?.first_date ?? null)

  const segRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)

  const updateIndicator = useCallback(() => {
    const activeBtn = segRef.current?.querySelector<HTMLElement>('.seg-btn.active')
    const indicator = indicatorRef.current
    if (!activeBtn || !indicator) return
    indicator.style.width = `${activeBtn.offsetWidth}px`
    indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`
  }, [])

  // Пока таб скрыт (display: none), offsetWidth равен нулю — считаем после показа таба.
  useEffect(() => {
    if (!active) return
    const frame = requestAnimationFrame(updateIndicator)
    return () => cancelAnimationFrame(frame)
  }, [active, mode, updateIndicator])

  useEffect(() => {
    if (!active) return
    let timer = 0
    const onResize = () => {
      clearTimeout(timer)
      timer = window.setTimeout(updateIndicator, RESIZE_DEBOUNCE_MS)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [active, updateIndicator])

  const selectMode = (next: ChartMode) => {
    setMode(next)
    // Порт MonthPicker.reset: вход в календарный режим начинается с текущего
    // месяца или года, а не с того, на котором остановились в прошлый раз.
    if (next === 'month') setSelectedMonth(currentYearMonth())
    if (next === 'year') setSelectedYear(clampYear(currentYear(), firstMonth?.year ?? null))
  }

  return (
    <>
      <div className="chart-filters">
        <div className="seg-control liquid-glass" ref={segRef}>
          <div className="seg-indicator" ref={indicatorRef} />
          {MODES.map((item) => (
            <button
              key={item.value}
              className={item.value === mode ? 'seg-btn active' : 'seg-btn'}
              onClick={() => selectMode(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
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
          <MoodChart entries={entries} smooth={settings.chartSmooth} isMonthMode={isMonthMode} />
          <ChartStats entries={entries} showAnxiety={false} />
        </>
      )}

      {showEmpty && (
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <p className="empty-title">Нет данных</p>
          <p className="empty-sub">Добавь запись, чтобы увидеть график</p>
        </div>
      )}
    </>
  )
}

/** Дата первой записи → месяц нижней границы навигации. */
function parseFirstMonth(firstDate: string | null): YearMonth | null {
  if (!firstDate) return null
  const date = new Date(firstDate)
  if (Number.isNaN(date.getTime())) return null
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}
