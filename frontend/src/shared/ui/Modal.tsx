import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'

import { useScrollLock } from '../lib/useScrollLock'

import './modal.css'

const MORPH_MS = 340
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface ModalProps {
  open: boolean
  onClose: () => void
  titleId: string
  initialFocusRef?: RefObject<HTMLElement | null>
  closeDisabled?: boolean
  closeOnBackdrop?: boolean
  className?: string
  overlayClassName?: string
  morphFrom?: DOMRect | null
  children: ReactNode
}

/** Нативный modal dialog с возвратом фокуса и управляемым закрытием. */
export function Modal({
  open,
  onClose,
  titleId,
  initialFocusRef,
  closeDisabled = false,
  closeOnBackdrop = true,
  className,
  overlayClassName,
  morphFrom,
  children,
}: ModalProps) {
  const [mounted, setMounted] = useState(open)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useScrollLock(mounted)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    if (!mounted) return

    const finish = () => {
      if (dialogRef.current?.open) {
        if (typeof dialogRef.current.close === 'function') dialogRef.current.close()
        else dialogRef.current.removeAttribute('open')
      }
      setMounted(false)
      const target = returnFocusRef.current
      returnFocusRef.current = null
      if (target?.isConnected) target.focus()
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish()
      return
    }
    const timer = window.setTimeout(finish, MORPH_MS)
    return () => window.clearTimeout(timer)
  }, [mounted, open])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const box = boxRef.current
    if (!dialog || !box || !mounted) return

    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      requestAnimationFrame(() => {
        const initial = initialFocusRef?.current ?? document.getElementById(titleId)
        initial?.focus()
      })
    }

    if (open && morphFrom) {
      const rect = box.getBoundingClientRect()
      const scale = morphFrom.width / rect.width
      dialog.style.setProperty(
        '--morph-x',
        `${morphFrom.left + morphFrom.width / 2 - rect.left - rect.width / 2}px`,
      )
      dialog.style.setProperty(
        '--morph-y',
        `${morphFrom.top + morphFrom.height / 2 - rect.top - rect.height / 2}px`,
      )
      dialog.style.setProperty('--morph-k', `${scale}`)
      dialog.style.setProperty('--morph-r', `${morphFrom.width / 2 / scale}px`)
    }
    dialog.dataset.morph = open ? 'in' : 'out'
  }, [initialFocusRef, mounted, morphFrom, open, titleId])

  if (!mounted) return null

  const boxClass = ['modal', className, morphFrom ? 'modal-morph' : null].filter(Boolean).join(' ')
  const overlayClass = ['modal-overlay', overlayClassName].filter(Boolean).join(' ')

  return (
    <dialog
      ref={dialogRef}
      className={overlayClass}
      aria-labelledby={titleId}
      aria-busy={closeDisabled}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault()
        if (!closeDisabled) onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop && !closeDisabled) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const dialog = event.currentTarget
        const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
          (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
        )
        if (!focusable.length) {
          event.preventDefault()
          dialog.focus()
          return
        }
        const first = focusable[0]
        const last = focusable.at(-1)
        const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
        if (event.shiftKey && (currentIndex <= 0 || document.activeElement === first)) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && (currentIndex === -1 || document.activeElement === last)) {
          event.preventDefault()
          first?.focus()
        }
      }}
    >
      <div ref={boxRef} className={boxClass}>
        {children}
      </div>
    </dialog>
  )
}

export function ModalCloseButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="btn-close"
      onClick={onClick}
      aria-label="Закрыть"
      disabled={disabled}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />
      </svg>
    </button>
  )
}
