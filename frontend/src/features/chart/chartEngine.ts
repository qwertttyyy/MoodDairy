/**
 * Рендерер канвас-графика. Порт отлаженного движка из
 * docs/redesign-src/shell.html (функции toRGBA, rgba, mix, pickTicks,
 * smoothPath, draw).
 *
 * Что здесь важно:
 *   • ось X календарная — точка стоит на своей дате;
 *   • подписи дат подбираются по измеренной ширине текста и не пересекаются;
 *   • известные значения соединяются через дни без записей;
 *   • длинные периоды сворачиваются по неделям и месяцам, как в «Здоровье»;
 *   • сглаживание ограничено интервалом соседних точек — кривая не выходит
 *     за пределы данных.
 *
 * Цвета берутся из CSS-переменных самого канваса, поэтому меняются вместе с
 * темой; перерисовку по смене темы запускает компонент.
 */

import type { ChartKind, DayPoint } from './types'

/** Цвет как четвёрка каналов. */
type Rgba = readonly [number, number, number, number]

/** Стиль отрисовки: кривая с заливкой либо столбики. */
export type ChartStyle = 'line' | 'bars'

export interface ChartOptions {
  rows: DayPoint[]
  kind: ChartKind
  style: ChartStyle
  /** Плавная кривая или ломаная — настройка «Плавный график». */
  smooth: boolean
}

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
]

/** Выше этого множителя пиксели уже не различимы, а память тратится впустую. */
const MAX_DPR = 2.5
/** Дней в периоде, после которых значения сворачиваются по неделям и по месяцам. */
const WEEK_AGGREGATION_FROM = 45
const MONTH_AGGREGATION_FROM = 200
/** Самая широкая подпись даты — по ней считается, сколько их поместится. */
const WIDEST_LABEL = '30 сен'
const LABEL_GAP = 16
/** Просвет между соседними подписями оси X, ниже которого они читаются как одно слово. */
const LABEL_MIN_GAP = 6
/** Доля шага оси, которую занимает столбик; остальное — просвет между столбиками. */
const BAR_SLOT_RATIO = 0.62

type Aggregation = 'none' | 'week' | 'month'

/** Точка графика в координатах канваса. */
interface Point {
  x: number
  y: number
  value: number
}

const FALLBACK = {
  line: [10, 124, 140, 1],
  fillTop: [10, 124, 140, 0.2],
  fillBottom: [10, 124, 140, 0.01],
  grid: [198, 198, 200, 1],
  text: [114, 114, 122, 1],
} satisfies Record<string, Rgba>

/**
 * Разбор цвета из CSS-переменной.
 * Пробный контекст канваса нормализует любую запись цвета, которую понимает
 * браузер, — от `#rgb` до `color-mix()`.
 */
let probeContext: CanvasRenderingContext2D | null = null

function toRgba(value: string, fallback: Rgba): Rgba {
  if (!value) return fallback
  if (!probeContext) probeContext = document.createElement('canvas').getContext('2d')
  const probe = probeContext
  if (!probe) return fallback

  probe.fillStyle = '#000000'
  probe.fillStyle = value
  const parsed = probe.fillStyle
  if (typeof parsed !== 'string') return fallback
  if (parsed.startsWith('#')) {
    return [
      parseInt(parsed.slice(1, 3), 16),
      parseInt(parsed.slice(3, 5), 16),
      parseInt(parsed.slice(5, 7), 16),
      1,
    ]
  }
  const parts = parsed.match(/[\d.]+/g)
  if (!parts || parts.length < 3) return fallback
  const [red, green, blue, alpha] = parts
  if (red === undefined || green === undefined || blue === undefined) return fallback
  return [+red, +green, +blue, alpha === undefined ? 1 : +alpha]
}

function rgba(color: Rgba, alpha?: number): string {
  const a = alpha === undefined ? color[3] : alpha * color[3]
  return `rgba(${color[0]},${color[1]},${color[2]},${a})`
}

/** Линейная смесь двух цветов: t = 0 — первый, t = 1 — второй. */
function mix(from: Rgba, to: Rgba, t: number): Rgba {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
    from[3] + (to[3] - from[3]) * t,
  ]
}

/** Подписи оси X: индексы дней и формат — так, чтобы текст гарантированно не налезал. */
function pickTicks(
  rows: DayPoint[],
  innerWidth: number,
  ctx: CanvasRenderingContext2D,
): { indexes: number[]; format: (date: Date) => string } {
  const count = rows.length

  if (count > MONTH_AGGREGATION_FROM) {
    // Год: значения свёрнуты по месяцам, и точка месяца стоит в середине его
    // дней. Подпись ставим туда же — иначе она систематически уезжает влево,
    // к первому числу, и не совпадает ни с точкой, ни со столбиком.
    const centers: number[] = []
    let start = 0
    for (let i = 1; i <= count; i++) {
      const current = rows[i]
      const first = rows[start]
      const monthEnded =
        i === count ||
        (current !== undefined &&
          first !== undefined &&
          current.date.getMonth() !== first.date.getMonth())
      if (monthEnded) {
        centers.push(Math.round((start + i - 1) / 2))
        start = i
      }
    }
    const every = Math.ceil(centers.length / Math.max(2, Math.floor(innerWidth / 42)))
    return {
      indexes: centers.filter((_, position) => position % every === 0),
      format: (date) => MONTHS_SHORT[date.getMonth()] ?? '',
    }
  }

  const labelWidth = ctx.measureText(WIDEST_LABEL).width + LABEL_GAP
  const maxTicks = Math.max(2, Math.floor(innerWidth / labelWidth))
  let step = Math.max(1, Math.ceil((count - 1) / maxTicks))
  if (count > 90) step = Math.max(step, 15)

  const indexes: number[] = []
  for (let i = count - 1; i >= 0; i -= step) indexes.push(i)
  indexes.reverse()
  // Крайняя левая подпись, стоящая вплотную к следующей, только мешает.
  const firstIndex = indexes[0]
  if (indexes.length > 1 && firstIndex !== undefined && firstIndex < step * 0.5) indexes.shift()

  return {
    indexes,
    format: (date) => `${date.getDate()} ${MONTHS_SHORT[date.getMonth()] ?? ''}`,
  }
}

/**
 * Ведёт путь через точки. В плавном режиме контрольные точки безье зажаты
 * между соседними значениями по Y — кривая не «выстреливает» за пределы данных.
 */
function tracePath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  smooth: boolean,
  continuePath = false,
): void {
  if (points.length < 2) return
  const first = points[0]
  if (!first) return
  if (continuePath) ctx.lineTo(first.x, first.y)
  else ctx.moveTo(first.x, first.y)

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    if (!p1 || !p2) continue
    if (!smooth) {
      ctx.lineTo(p2.x, p2.y)
      continue
    }
    const p0 = points[i - 1] ?? p1
    const p3 = points[i + 2] ?? p2
    const t = 0.34
    const c1x = p1.x + ((p2.x - p0.x) * t) / 2
    const c2x = p2.x - ((p3.x - p1.x) * t) / 2
    const low = Math.min(p1.y, p2.y)
    const high = Math.max(p1.y, p2.y)
    const c1y = clamp(p1.y + ((p2.y - p0.y) * t) / 2, low, high)
    const c2y = clamp(p2.y - ((p3.y - p1.y) * t) / 2, low, high)
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y)
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

/** Ключ интервала свёртки: номер месяца либо номер недели (с понедельника). */
function bucketKey(date: Date, aggregation: Aggregation): number {
  if (aggregation === 'month') return date.getFullYear() * 12 + date.getMonth()
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return Math.round(monday.getTime() / 864e5)
}

/** Накопитель интервала свёртки. */
interface Bucket {
  sum: number
  count: number
  firstIndex: number
  lastIndex: number
}

/**
 * Значения по дням либо свёрнутые по неделям и месяцам.
 * На длинном периоде ежедневные точки превращаются в частокол, поэтому
 * длинные отрезки усредняются — так же поступает приложение «Здоровье».
 */
function collectPoints(
  rows: DayPoint[],
  values: Array<number | null>,
  aggregation: Aggregation,
  x: (index: number) => number,
  y: (value: number) => number,
): Point[] {
  if (aggregation === 'none') {
    const points: Point[] = []
    values.forEach((value, index) => {
      if (value !== null) points.push({ x: x(index), y: y(value), value })
    })
    return points
  }

  const buckets = new Map<number, Bucket>()
  rows.forEach((row, index) => {
    const key = bucketKey(row.date, aggregation)
    const bucket = buckets.get(key) ?? {
      sum: 0,
      count: 0,
      firstIndex: index,
      lastIndex: index,
    }
    bucket.lastIndex = index
    const value = values[index]
    if (value !== null && value !== undefined) {
      bucket.sum += value
      bucket.count++
    }
    buckets.set(key, bucket)
  })

  const points: Point[] = []
  for (const bucket of buckets.values()) {
    if (!bucket.count) continue
    const average = bucket.sum / bucket.count
    const center = (bucket.firstIndex + bucket.lastIndex) / 2
    points.push({ x: x(center), y: y(average), value: average })
  }
  return points
}

/** Рисует график целиком: сетку, подписи осей и сами данные. */
export function drawChart(canvas: HTMLCanvasElement, options: ChartOptions): void {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (!width || !height) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  // setTransform, а не scale: scale множится при повторных вызовах.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const styles = getComputedStyle(canvas)
  const cssValue = (name: string): string => styles.getPropertyValue(name).trim()
  const cssNumber = (name: string, fallback: number): number =>
    parseFloat(cssValue(name)) || fallback

  const isAnxiety = options.kind === 'anxiety'
  const colorLine = toRgba(cssValue('--ch-line'), FALLBACK.line)
  const colorFillTop = toRgba(cssValue('--ch-fill-top'), FALLBACK.fillTop)
  const colorFillBottom = toRgba(cssValue('--ch-fill-bottom'), FALLBACK.fillBottom)
  const colorGrid = toRgba(cssValue('--ch-grid'), FALLBACK.grid)
  const colorText = toRgba(cssValue('--ch-text'), FALLBACK.text)
  const colorBar = toRgba(cssValue('--ch-bar'), colorLine)
  const barHighValue = cssValue('--ch-bar-hi')
  const colorBarHigh = toRgba(barHighValue, colorBar)
  const colorDot = cssValue('--ch-dot')

  const fontSize = cssNumber('--ch-font', 11)
  ctx.font = `500 ${fontSize}px ${styles.fontFamily}`

  const low = 1
  const high = isAnxiety ? 5 : 9
  const yTicks = isAnxiety ? [1, 2, 3, 4, 5] : [1, 3, 5, 7, 9]

  const padTop = cssNumber('--ch-pad-top', 8)
  const padRight = cssNumber('--ch-pad-right', 4)
  const padBottom = cssNumber('--ch-pad-bottom', 18)
  const padLeft = cssNumber('--ch-pad-left', 14)
  const innerWidth = width - padLeft - padRight
  const innerHeight = height - padTop - padBottom
  if (innerWidth <= 4 || innerHeight <= 4) return

  const { rows } = options
  const lastIndex = Math.max(rows.length - 1, 1)
  const x = (index: number): number =>
    padLeft + (rows.length < 2 ? innerWidth / 2 : (innerWidth * index) / lastIndex)
  const y = (value: number): number =>
    padTop + innerHeight - (innerHeight * (value - low)) / (high - low)
  const baseY = padTop + innerHeight

  ctx.strokeStyle = rgba(colorGrid)
  ctx.lineWidth = 1
  for (const tick of yTicks) {
    // Полпикселя — чтобы линия толщиной 1 не размазывалась на два ряда пикселей.
    const lineY = Math.round(y(tick)) + 0.5
    ctx.beginPath()
    ctx.moveTo(padLeft, lineY)
    ctx.lineTo(width - padRight, lineY)
    ctx.stroke()
  }

  ctx.fillStyle = rgba(colorText)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const tick of yTicks) ctx.fillText(String(tick), 0, y(tick))

  drawXLabels(ctx, rows, { width, height, innerWidth, x, color: colorText })

  const values = rows.map((row) => (isAnxiety ? row.anxiety : row.mood))
  const aggregation: Aggregation =
    rows.length <= WEEK_AGGREGATION_FROM
      ? 'none'
      : rows.length <= MONTH_AGGREGATION_FROM
        ? 'week'
        : 'month'

  const points = collectPoints(rows, values, aggregation, x, y)
  if (!points.length) return

  if (options.style === 'bars') {
    const firstPoint = points[0]
    const lastPoint = points.at(-1)
    if (!firstPoint || !lastPoint) return
    const slot = points.length > 1 ? (lastPoint.x - firstPoint.x) / (points.length - 1) : innerWidth
    // Верхний предел нужен коротким периодам: без него восемь месяцев года
    // дают столбики шире, чем выше, и график читается как ряд плашек.
    const maxWidth = cssNumber('--ch-bar-max', innerWidth)
    const barWidth = Math.max(1.5, Math.min(slot * BAR_SLOT_RATIO, maxWidth))
    const radius = Math.min(barWidth / 2, 3)
    for (const point of points) {
      const tone = (point.value - low) / (high - low)
      const color = barHighValue ? mix(colorBar, colorBarHigh, tone) : colorBar
      // Минимальное значение шкалы тоже должно быть видно — отсюда 3 пикселя.
      const top = Math.min(point.y, baseY - 3)
      // Крайние столбики иначе наполовину уходят за холст и налезают на
      // подписи шкалы Y — поэтому прижимаем их к границам поля графика.
      const left = clamp(point.x - barWidth / 2, padLeft, width - padRight - barWidth)
      ctx.fillStyle = rgba(color)
      ctx.beginPath()
      ctx.roundRect(left, top, barWidth, baseY - top, [radius, radius, 0, 0])
      ctx.fill()
    }
    return
  }

  const gradient = ctx.createLinearGradient(0, padTop, 0, baseY)
  gradient.addColorStop(0, rgba(colorFillTop))
  gradient.addColorStop(1, rgba(colorFillBottom))
  ctx.fillStyle = gradient
  if (points.length >= 2) {
    const firstPoint = points[0]
    const lastPoint = points.at(-1)
    if (!firstPoint || !lastPoint) return
    ctx.beginPath()
    tracePath(ctx, points, options.smooth)
    ctx.lineTo(lastPoint.x, baseY)
    ctx.lineTo(firstPoint.x, baseY)
    ctx.closePath()
    ctx.fill()
  }

  const lineWidth = cssNumber('--ch-width', 2)
  ctx.strokeStyle = rgba(colorLine)
  ctx.fillStyle = rgba(colorLine)
  ctx.lineWidth = lineWidth
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  if (points.length < 2) {
    const point = points[0]
    if (!point) return
    ctx.arc(point.x, point.y, lineWidth * 0.8, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // Пропуски сохраняют расстояние по времени, но не разрывают линию.
    tracePath(ctx, points, options.smooth)
    ctx.stroke()
  }

  if (colorDot) {
    const dotSize = cssNumber('--ch-dot-size', 1.8)
    ctx.fillStyle = rgba(toRgba(colorDot, colorLine))
    for (const point of points) {
      ctx.beginPath()
      ctx.arc(point.x, point.y, dotSize, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

interface LabelsGeometry {
  width: number
  height: number
  innerWidth: number
  x: (index: number) => number
  color: Rgba
}

/** Готовая к отрисовке подпись оси X с её границами по горизонтали. */
interface LabelBox {
  text: string
  x: number
  align: CanvasTextAlign
  left: number
  right: number
}

/**
 * Подписи оси X по календарю: крайние прижимаются к краям, а не обрезаются.
 *
 * Шаг подписей подобран по средней ширине, но у краёв прижатая подпись
 * сдвигается внутрь и может подойти к соседней вплотную. Поэтому готовые
 * границы проверяются ещё раз, справа налево, и слипшаяся подпись убирается:
 * лучше показать дат меньше, чем склеить их в одно слово.
 */
function drawXLabels(
  ctx: CanvasRenderingContext2D,
  rows: DayPoint[],
  geometry: LabelsGeometry,
): void {
  if (!rows.length) return
  const ticks = pickTicks(rows, geometry.innerWidth, ctx)

  const boxes: LabelBox[] = ticks.indexes.flatMap((index) => {
    const row = rows[index]
    if (!row) return []
    const text = ticks.format(row.date)
    const half = ctx.measureText(text).width / 2
    const center = geometry.x(index)
    if (center - half < 0) return { text, x: 0, align: 'left', left: 0, right: half * 2 }
    if (center + half > geometry.width) {
      return {
        text,
        x: geometry.width,
        align: 'right',
        left: geometry.width - half * 2,
        right: geometry.width,
      }
    }
    return { text, x: center, align: 'center', left: center - half, right: center + half }
  })

  ctx.fillStyle = rgba(geometry.color)
  ctx.textBaseline = 'alphabetic'

  let nextLeft = Number.POSITIVE_INFINITY
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i]
    if (!box) continue
    if (box.right + LABEL_MIN_GAP > nextLeft) continue
    ctx.textAlign = box.align
    ctx.fillText(box.text, box.x, geometry.height - 4)
    nextLeft = box.left
  }
}
