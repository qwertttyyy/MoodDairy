/**
 * Один канвас-график: настроение кривой либо тревога столбиками.
 * Вся отрисовка — в chartEngine, здесь только жизненный цикл канваса.
 */

import { useEffect, useId, useMemo, useRef } from 'react'

import { drawChart } from './chartEngine'
import type { ChartStyle } from './chartEngine'
import { buildDailySeries, rangeOfEntries } from './series'
import type { ChartKind, MoodChartProps } from './types'

import './chart.css'

/** Тревога — столбики: её оценка дискретная, кривая между ними ничего не значит. */
const STYLE: Record<ChartKind, ChartStyle> = { mood: 'line', anxiety: 'bars' }

export function MoodChart({
  entries,
  smooth,
  kind = 'mood',
  range,
  isMonthMode = false,
}: MoodChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const descriptionId = useId()

  const rows = useMemo(
    () => buildDailySeries(entries, range ?? rangeOfEntries(entries, isMonthMode)),
    [entries, range, isMonthMode],
  )
  const label = kind === 'anxiety' ? 'Тревога' : 'Настроение'
  const textSummary = useMemo(() => {
    const points = rows.flatMap((row) => {
      const value = row[kind]
      if (value === null) return []
      const date = row.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      return [`${date}: ${value.toFixed(1)}`]
    })
    return points.length ? `${label}. ${points.join('; ')}.` : `${label}: нет данных.`
  }, [kind, label, rows])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const render = () => drawChart(canvas, { rows, kind, style: STYLE[kind], smooth })
    let renderFrame = 0
    const scheduleRender = () => {
      window.cancelAnimationFrame(renderFrame)
      renderFrame = window.requestAnimationFrame(render)
    }
    render()

    // Таб может быть скрыт (display: none) — тогда ширина нулевая и рисовать
    // нечего; перерисовку запустит наблюдатель, когда таб покажут.
    const sizeObserver = new ResizeObserver(scheduleRender)
    sizeObserver.observe(canvas)

    // Тема меняет только CSS-переменные, а канвас сам об этом не узнает.
    const themeObserver = new MutationObserver(scheduleRender)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })

    return () => {
      sizeObserver.disconnect()
      themeObserver.disconnect()
      window.cancelAnimationFrame(renderFrame)
    }
  }, [rows, kind, smooth])

  return (
    <div className={`chartbox ${kind === 'anxiety' ? 'cb-anx' : 'cb-mood'}`}>
      <canvas
        className={kind === 'anxiety' ? 'ch-anx' : 'ch-mood'}
        ref={canvasRef}
        role="img"
        aria-label={`График: ${label.toLowerCase()}`}
        aria-describedby={descriptionId}
      >
        {textSummary}
      </canvas>
      <p className="sr-only" id={descriptionId}>
        {textSummary}
      </p>
    </div>
  )
}
