/**
 * Один канвас-график: настроение кривой либо тревога столбиками.
 * Вся отрисовка — в chartEngine, здесь только жизненный цикл канваса.
 */

import { useEffect, useMemo, useRef } from 'react'

import { drawChart } from './chartEngine'
import type { ChartStyle } from './chartEngine'
import { buildDailySeries, rangeOfEntries } from './series'
import type { ChartKind, MoodChartProps } from './types'

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

  const rows = useMemo(
    () => buildDailySeries(entries, range ?? rangeOfEntries(entries, isMonthMode)),
    [entries, range, isMonthMode],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const render = () => drawChart(canvas, { rows, kind, style: STYLE[kind], smooth })
    render()

    // Таб может быть скрыт (display: none) — тогда ширина нулевая и рисовать
    // нечего; перерисовку запустит наблюдатель, когда таб покажут.
    const sizeObserver = new ResizeObserver(render)
    sizeObserver.observe(canvas)

    // Тема меняет только CSS-переменные, а канвас сам об этом не узнает.
    const themeObserver = new MutationObserver(render)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })

    return () => {
      sizeObserver.disconnect()
      themeObserver.disconnect()
    }
  }, [rows, kind, smooth])

  return (
    <div className={`chartbox ${kind === 'anxiety' ? 'cb-anx' : 'cb-mood'}`}>
      <canvas className={kind === 'anxiety' ? 'ch-anx' : 'ch-mood'} ref={canvasRef} />
    </div>
  )
}
