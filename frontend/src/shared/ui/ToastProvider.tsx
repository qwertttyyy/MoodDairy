import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type ShowToast = (message: string, isError?: boolean) => void

const ToastContext = createContext<ShowToast | null>(null)

export function useToast(): ShowToast {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast должен вызываться внутри ToastProvider')
  return show
}

const VISIBLE_MS = 2500
const FADE_MS = 300

interface ToastState {
  message: string
  isError: boolean
  /** Классы .show/.hidden управляют CSS-анимацией и повторяют старое поведение. */
  visible: boolean
  mounted: boolean
}

const EMPTY: ToastState = { message: '', isError: false, visible: false, mounted: false }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(EMPTY)
  const timers = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  const show = useCallback<ShowToast>(
    (message, isError = false) => {
      clearTimers()
      setToast({ message, isError, visible: false, mounted: true })
      // Класс .show добавляется отдельным кадром, иначе CSS-переход не запустится.
      requestAnimationFrame(() => {
        setToast((prev) => (prev.mounted ? { ...prev, visible: true } : prev))
      })
      timers.current.push(
        window.setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), VISIBLE_MS),
        window.setTimeout(() => setToast(EMPTY), VISIBLE_MS + FADE_MS),
      )
    },
    [clearTimers],
  )

  useEffect(() => clearTimers, [clearTimers])

  const className = [
    'toast',
    toast.mounted ? '' : 'hidden',
    toast.isError ? 'error' : '',
    toast.visible ? 'show' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={className}>{toast.message}</div>
    </ToastContext.Provider>
  )
}
