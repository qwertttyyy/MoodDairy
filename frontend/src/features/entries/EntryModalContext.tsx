import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import type { DecryptedEntry } from './types'

interface EntryModalValue {
  isOpen: boolean
  /** Запись при редактировании, `null` при создании. */
  editing: DecryptedEntry | null
  mood: number
  anxiety: number
  /** Кнопка, из которой выросло окно: из неё же оно и схлопнется при закрытии. */
  origin: DOMRect | null
  open: (entry?: DecryptedEntry | null, origin?: DOMRect | null) => void
  close: () => void
  selectMood: (value: number) => void
  /** Повторный клик по той же оценке сбрасывает тревогу (она необязательна). */
  selectAnxiety: (value: number) => void
}

const EntryModalContext = createContext<EntryModalValue | null>(null)

export function useEntryModal(): EntryModalValue {
  const value = useContext(EntryModalContext)
  if (!value) throw new Error('useEntryModal должен вызываться внутри EntryModalProvider')
  return value
}

/**
 * Состояние формы записи вынесено в контекст: памятка открывается поверх формы
 * и должна уметь выставить выбранную в ней оценку.
 */
export function EntryModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [editing, setEditing] = useState<DecryptedEntry | null>(null)
  const [mood, setMood] = useState(0)
  const [anxiety, setAnxiety] = useState(0)
  const [origin, setOrigin] = useState<DOMRect | null>(null)

  const open = useCallback((entry?: DecryptedEntry | null, from?: DOMRect | null) => {
    setEditing(entry ?? null)
    setMood(entry ? entry.mood : 0)
    setAnxiety(entry?.anxiety ?? 0)
    setOrigin(from ?? null)
    setIsOpen(true)
  }, [])

  // Точку роста не сбрасываем: окно ещё схлопывается в неё, пока идёт анимация
  // закрытия, и обнуление посреди неё уронило бы окно в центр экрана.
  const close = useCallback(() => {
    setIsOpen(false)
    setEditing(null)
    setMood(0)
    setAnxiety(0)
  }, [])

  const selectAnxiety = useCallback((value: number) => {
    setAnxiety((prev) => (prev === value ? 0 : value))
  }, [])

  const value = useMemo(
    () => ({
      isOpen,
      editing,
      mood,
      anxiety,
      origin,
      open,
      close,
      selectMood: setMood,
      selectAnxiety,
    }),
    [isOpen, editing, mood, anxiety, origin, open, close, selectAnxiety],
  )

  return <EntryModalContext.Provider value={value}>{children}</EntryModalContext.Provider>
}
