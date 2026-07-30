import { useEffect, useRef } from 'react'

import { MOOD_COLORS } from '../../shared/constants'
import { formatDateShort } from '../../shared/lib/dates'
import type { ChartEntry, MoodChartProps } from './types'

/** Высота канваса в CSS-пикселях — совпадает с `.chart-wrapper canvas` в styles.css. */
const CHART_HEIGHT = 200
/** Горизонтальные паддинги обёртки (16px 10px): канвас уже её на 20px. */
const WRAPPER_PADDING = 20
const RESIZE_DEBOUNCE_MS = 150

/** Отступы области построения внутри канваса. */
const PAD = { left: 28, right: 12, top: 16, bottom: 32 }

const GRID_VALUES = [1, 3, 5, 7, 9]
const GRID_COLOR = 'rgba(128,128,128,0.12)'
const FALLBACK_TEXT_COLOR = '#aaa'
const FALLBACK_ACCENT_COLOR = '#007aff'
const DEFAULT_ACCENT_RGB: [number, number, number] = [0, 122, 255]

/** Шкала настроения 1..9: минимум и размах для перевода оценки в координату. */
const MOOD_MIN = 1
const MOOD_RANGE = 8

/** Дней больше этого числа — включаем сглаживание скользящим средним. */
const SMA_THRESHOLD = 14
/** Точки на линии рисуем, только пока график не слишком плотный. */
const MAX_DOTS = 60
/** Максимум подписей оси X вне режима месяца. */
const MAX_X_LABELS = 6
/** В режиме месяца подписи по числам — только если точек не больше дней в месяце. */
const MONTH_MODE_MAX_POINTS = 31

/** Среднее настроение за один день. */
interface DayAverage {
  day: string
  avg: number
}

/** Точка графика в координатах канваса. */
interface ChartPoint {
  x: number
  y: number
  mood: number
  ts: string
}

/** Размеры канваса и области построения. */
interface Geometry {
  width: number
  height: number
  plotWidth: number
  plotHeight: number
}

/** Цвета темы, прочитанные из CSS-переменных. */
interface Palette {
  text: string
  accent: string
}

interface DrawParams {
  entries: ChartEntry[]
  smooth: boolean
  isMonthMode: boolean
  width: number
  height: number
}

function makeGeometry(width: number, height: number): Geometry {
  return {
    width,
    height,
    plotWidth: width - PAD.left - PAD.right,
    plotHeight: height - PAD.top - PAD.bottom,
  }
}

/** Оценка настроения → координата Y (1 внизу, 9 вверху). */
function moodToY(mood: number, geom: Geometry): number {
  return PAD.top + geom.plotHeight - ((mood - MOOD_MIN) / MOOD_RANGE) * geom.plotHeight
}

function readPalette(): Palette {
  const styles = getComputedStyle(document.documentElement)
  return {
    text: styles.getPropertyValue('--c-tertiary').trim() || FALLBACK_TEXT_COLOR,
    accent: styles.getPropertyValue('--accent').trim() || FALLBACK_ACCENT_COLOR,
  }
}

/** `#rrggbb` → компоненты RGB. Нехекс-значение переменной темы даёт цвет по умолчанию. */
function hexToRgb(hex: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return DEFAULT_ACCENT_RGB
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function moodColor(mood: number, fallback: string): string {
  return MOOD_COLORS[mood] || fallback
}

/** Группирует записи по дате (YYYY-MM-DD) и усредняет настроение внутри дня. */
function aggregateByDay(entries: ChartEntry[]): DayAverage[] {
  const byDay = new Map<string, number[]>()
  for (const entry of entries) {
    const day = entry.timestamp.slice(0, 10)
    const moods = byDay.get(day)
    if (moods) moods.push(entry.mood)
    else byDay.set(day, [entry.mood])
  }

  return [...byDay]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, moods]) => ({
      day,
      avg: moods.reduce((sum, mood) => sum + mood, 0) / moods.length,
    }))
}

/** Скользящее среднее с центрированным окном: края усредняются по неполному окну. */
function simpleMovingAverage(data: DayAverage[], window: number): DayAverage[] {
  const half = Math.floor(window / 2)
  return data.map((item, i) => {
    let sum = 0
    let count = 0
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < data.length) {
        sum += data[j].avg
        count++
      }
    }
    return { day: item.day, avg: sum / count }
  })
}

/** Чем длиннее период, тем шире окно сглаживания. */
function smoothingWindow(dayCount: number): number {
  if (dayCount > 180) return 7
  if (dayCount > 60) return 5
  return 3
}

function toPoints(days: DayAverage[], geom: Geometry): ChartPoint[] {
  const lastIndex = Math.max(days.length - 1, 1)
  return days.map((day, i) => ({
    x: PAD.left + (i / lastIndex) * geom.plotWidth,
    y: moodToY(day.avg, geom),
    mood: Math.round(day.avg),
    ts: day.day,
  }))
}

function drawGrid(ctx: CanvasRenderingContext2D, geom: Geometry, textColor: string): void {
  ctx.font = '500 10px Nunito,sans-serif'
  ctx.fillStyle = textColor
  ctx.textAlign = 'right'
  for (const value of GRID_VALUES) {
    const y = moodToY(value, geom)
    ctx.strokeStyle = GRID_COLOR
    ctx.lineWidth = 0.5
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(PAD.left, y)
    ctx.lineTo(PAD.left + geom.plotWidth, y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillText(String(value), PAD.left - 6, y + 4)
  }
}

/**
 * Продолжает текущий путь от первой точки до последней.
 * Плавный режим: контрольные точки безье стоят на середине отрезка по X —
 * кривая проходит через все точки и не «выстреливает» за их пределы.
 */
function tracePath(ctx: CanvasRenderingContext2D, pts: ChartPoint[], smooth: boolean): void {
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]
    if (smooth) {
      const cpX = (prev.x + curr.x) / 2
      ctx.bezierCurveTo(cpX, prev.y, cpX, curr.y, curr.x, curr.y)
    } else {
      ctx.lineTo(curr.x, curr.y)
    }
  }
}

function drawArea(
  ctx: CanvasRenderingContext2D,
  pts: ChartPoint[],
  geom: Geometry,
  accent: string,
  smooth: boolean,
): void {
  const baseY = PAD.top + geom.plotHeight
  const [r, g, b] = hexToRgb(accent)
  const gradient = ctx.createLinearGradient(0, PAD.top, 0, baseY)
  gradient.addColorStop(0, `rgba(${r},${g},${b},0.2)`)
  gradient.addColorStop(1, `rgba(${r},${g},${b},0.01)`)

  const first = pts[0]
  const last = pts[pts.length - 1]
  ctx.beginPath()
  ctx.moveTo(first.x, baseY)
  ctx.lineTo(first.x, first.y)
  tracePath(ctx, pts, smooth)
  ctx.lineTo(last.x, baseY)
  ctx.closePath()
  ctx.fillStyle = gradient
  ctx.fill()
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  pts: ChartPoint[],
  accent: string,
  smooth: boolean,
): void {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  tracePath(ctx, pts, smooth)
  ctx.strokeStyle = accent
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
}

function drawDots(ctx: CanvasRenderingContext2D, pts: ChartPoint[], accent: string): void {
  for (const point of pts) {
    ctx.beginPath()
    ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = moodColor(point.mood, accent)
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
}

function drawSinglePoint(
  ctx: CanvasRenderingContext2D,
  point: ChartPoint,
  accent: string,
): void {
  ctx.beginPath()
  ctx.arc(point.x, point.y, 6, 0, Math.PI * 2)
  ctx.fillStyle = moodColor(point.mood, accent)
  ctx.fill()
}

function drawRotatedLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(-Math.PI / 6)
  ctx.textAlign = 'right'
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

function drawXLabels(
  ctx: CanvasRenderingContext2D,
  pts: ChartPoint[],
  geom: Geometry,
  isMonthMode: boolean,
  textColor: string,
): void {
  ctx.fillStyle = textColor
  ctx.font = '500 9px Nunito,sans-serif'
  const labelY = geom.height - PAD.bottom + 14

  if (isMonthMode && pts.length <= MONTH_MODE_MAX_POINTS) {
    for (const point of pts) {
      const dayNum = new Date(point.ts).getDate()
      if (dayNum % 2 === 1) drawRotatedLabel(ctx, formatDateShort(point.ts), point.x, labelY)
    }
    return
  }

  const step = Math.max(1, Math.floor(pts.length / MAX_X_LABELS))
  for (let i = 0; i < pts.length; i += step) {
    drawRotatedLabel(ctx, formatDateShort(pts[i].ts), pts[i].x, labelY)
  }
  // Шаг мог не попасть на последнюю точку — подписываем её отдельно.
  const last = pts[pts.length - 1]
  if (pts.length % step !== 1) drawRotatedLabel(ctx, formatDateShort(last.ts), last.x, labelY)
}

/** Рисует весь график: сетку, заливку, линию, точки и подписи оси X. */
function drawChart(ctx: CanvasRenderingContext2D, params: DrawParams): void {
  const { entries, smooth, isMonthMode, width, height } = params
  const geom = makeGeometry(width, height)
  const palette = readPalette()

  drawGrid(ctx, geom, palette.text)

  const days = aggregateByDay(entries)
  const series =
    days.length > SMA_THRESHOLD ? simpleMovingAverage(days, smoothingWindow(days.length)) : days
  const pts = toPoints(series, geom)

  if (pts.length < 2) {
    if (pts.length === 1) drawSinglePoint(ctx, pts[0], palette.accent)
    return
  }

  drawArea(ctx, pts, geom, palette.accent, smooth)
  drawLine(ctx, pts, palette.accent, smooth)
  if (pts.length <= MAX_DOTS) drawDots(ctx, pts, palette.accent)
  drawXLabels(ctx, pts, geom, isMonthMode, palette.text)
}

/** Canvas-график настроения по дням. Перерисовывается при смене данных и размера обёртки. */
export function MoodChart({ entries, smooth, isMonthMode }: MoodChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    const canvas = canvasRef.current
    if (!wrapper || !canvas) return

    const render = () => {
      const width = wrapper.clientWidth - WRAPPER_PADDING
      // Таб графика может быть скрыт (display:none) — тогда ширина нулевая и рисовать нечего.
      // Перерисовку запустит ResizeObserver, когда таб покажут.
      if (width <= 0) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = CHART_HEIGHT * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${CHART_HEIGHT}px`
      // setTransform вместо scale: scale множится при повторных вызовах на том же контексте.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, CHART_HEIGHT)

      drawChart(ctx, { entries, smooth, isMonthMode, width, height: CHART_HEIGHT })
    }

    render()

    let timer = 0
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(render, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(wrapper)

    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [entries, smooth, isMonthMode])

  return (
    <div className="chart-wrapper liquid-glass" ref={wrapperRef}>
      <canvas ref={canvasRef} />
    </div>
  )
}
