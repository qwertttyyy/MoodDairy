import type { ReactNode } from 'react'

import { useScrollLock } from '../lib/useScrollLock'

interface ModalProps {
  open: boolean
  onClose: () => void
  /** Доп. класс на `.modal`: `modal-sm`, `modal-guide`. */
  className?: string
  children: ReactNode
}

/** Оверлей модалки. Клик по фону закрывает — как в старом фронте. */
export function Modal({ open, onClose, className, children }: ModalProps) {
  useScrollLock(open)
  if (!open) return null

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={className ? `modal liquid-glass ${className}` : 'modal liquid-glass'}>
        {children}
      </div>
    </div>
  )
}

/** Кнопка-крестик в шапке модалки. */
export function ModalCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn-icon-glass btn-close" onClick={onClick} aria-label="Закрыть">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  )
}
