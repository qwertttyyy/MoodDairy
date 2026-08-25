import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { useScrollLock } from '../lib/useScrollLock'

/** Длительность роста и схлопывания окна. Совпадает с --t-morph в modal.css. */
const MORPH_MS = 340

interface ModalProps {
  open: boolean
  onClose: () => void
  /** Доп. класс на `.modal`: `modal-sm`, `modal-guide`, `entry-form`. */
  className?: string
  /** Доп. класс на затемняющий слой вокруг окна. */
  overlayClassName?: string
  /** Кнопка, из которой окно вырастает и в которую схлопывается. */
  morphFrom?: DOMRect | null
  children: ReactNode
}

/**
 * Модальное окно: скруглённый прямоугольник с полями по краям экрана.
 * Клик по фону закрывает.
 *
 * Если передан `morphFrom`, окно появляется ростом из этой кнопки. Размонтируем
 * его не сразу: пока идёт обратная анимация, содержимое должно оставаться в DOM.
 */
export function Modal({
  open,
  onClose,
  className,
  overlayClassName,
  morphFrom,
  children,
}: ModalProps) {
  const [mounted, setMounted] = useState(open)
  const overlayRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useScrollLock(mounted)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), MORPH_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  /*
   * Сдвиг и масштаб считаем до первой отрисовки. Измеряем только на открытии:
   * при закрытии окно уже под анимацией, и getBoundingClientRect вернул бы
   * преобразованную рамку вместо исходной. Переменные ставим на оверлей —
   * пользовательские свойства наследуются, и окно их подхватит само.
   */
  useLayoutEffect(() => {
    const overlay = overlayRef.current
    const box = boxRef.current
    if (!overlay || !box) return

    if (open && morphFrom) {
      const rect = box.getBoundingClientRect()
      const scale = morphFrom.width / rect.width
      overlay.style.setProperty(
        '--morph-x',
        `${morphFrom.left + morphFrom.width / 2 - rect.left - rect.width / 2}px`,
      )
      overlay.style.setProperty(
        '--morph-y',
        `${morphFrom.top + morphFrom.height / 2 - rect.top - rect.height / 2}px`,
      )
      overlay.style.setProperty('--morph-k', `${scale}`)
      // Скругление гасится тем же масштабом, поэтому радиус берём делением:
      // на экране стартовая кромка совпадёт с круглой кнопкой.
      overlay.style.setProperty('--morph-r', `${morphFrom.width / 2 / scale}px`)
    }

    overlay.dataset.morph = open ? 'in' : 'out'
  }, [mounted, open, morphFrom])

  if (!mounted) return null

  const boxClass = ['modal', className, morphFrom ? 'modal-morph' : null].filter(Boolean).join(' ')
  const overlayClass = ['modal-overlay', overlayClassName].filter(Boolean).join(' ')

  return (
    <div
      ref={overlayRef}
      className={overlayClass}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={boxRef} className={boxClass}>
        {children}
      </div>
    </div>
  )
}

/** Кнопка-крестик в шапке окна: плоский кружок на поле. */
export function ModalCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn-close" onClick={onClick} aria-label="Закрыть">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />
      </svg>
    </button>
  )
}
