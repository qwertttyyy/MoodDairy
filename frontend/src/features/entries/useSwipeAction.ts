import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** Сдвиг по горизонтали, после которого жест считается свайпом, а не тапом. */
const AXIS_THRESHOLD = 8

/** Состояние текущего жеста. Живёт в ref: перерисовка на каждое касание не нужна. */
interface Gesture {
  x: number
  y: number
  /** Сдвиг строки на момент начала жеста — свайп продолжает его, а не обнуляет. */
  base: number
  axis: 'none' | 'x' | 'y'
}

type PointerHandler = (event: ReactPointerEvent<HTMLElement>) => void

export interface SwipeAction {
  /** Текущий сдвиг строки по X, от −actionWidth до 0. */
  offset: number
  /** Палец на экране и строка едет за ним — на время жеста анимация выключена. */
  dragging: boolean
  /** Строка сдвинута: кнопку под ней видно. */
  shifted: boolean
  /** Строка доехала до открытого положения. */
  isOpen: boolean
  close: () => void
  /** true, если последний жест был свайпом: такой клик нельзя считать тапом. */
  consumeGesture: () => boolean
  handlers: {
    onPointerDown: PointerHandler
    onPointerMove: PointerHandler
    onPointerUp: PointerHandler
    onPointerCancel: PointerHandler
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Свайп строки влево, открывающий кнопку действия — как в списках iOS.
 *
 * Работает только для касаний и пера: мышью строка не сдвигается, на десктопе
 * то же действие доступно из формы редактирования. Направление жеста
 * определяется по первым пикселям: вертикальное движение отдаём прокрутке.
 */
export function useSwipeAction(actionWidth: number): SwipeAction {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<Gesture | null>(null)
  const swiped = useRef(false)

  const onPointerDown = useCallback<PointerHandler>(
    (event) => {
      swiped.current = false
      if (event.pointerType === 'mouse') return
      gesture.current = { x: event.clientX, y: event.clientY, base: offset, axis: 'none' }
    },
    [offset],
  )

  const onPointerMove = useCallback<PointerHandler>(
    (event) => {
      const current = gesture.current
      if (!current) return

      const dx = event.clientX - current.x
      const dy = event.clientY - current.y

      if (current.axis === 'none') {
        // Жест ушёл вертикально — это прокрутка ленты, строку не трогаем.
        if (Math.abs(dy) > AXIS_THRESHOLD && Math.abs(dy) >= Math.abs(dx)) {
          gesture.current = null
          return
        }
        if (Math.abs(dx) <= AXIS_THRESHOLD) return
        current.axis = 'x'
        swiped.current = true
        setDragging(true)
        // Захват указателя: палец может уйти за пределы строки, а жест продолжится.
        event.currentTarget.setPointerCapture(event.pointerId)
      }

      setOffset(clamp(current.base + dx, -actionWidth, 0))
    },
    [actionWidth],
  )

  const finishGesture = useCallback<PointerHandler>(
    (event) => {
      const current = gesture.current
      gesture.current = null
      if (!current || current.axis !== 'x') return

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setDragging(false)
      // Дотянули больше половины — строка остаётся открытой, иначе возвращается.
      setOffset((shift) => (shift <= -actionWidth / 2 ? -actionWidth : 0))
    },
    [actionWidth],
  )

  const close = useCallback(() => setOffset(0), [])

  const consumeGesture = useCallback(() => {
    const wasSwipe = swiped.current
    swiped.current = false
    return wasSwipe
  }, [])

  return {
    offset,
    dragging,
    shifted: offset < 0,
    isOpen: offset <= -actionWidth,
    close,
    consumeGesture,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishGesture,
      onPointerCancel: finishGesture,
    },
  }
}
