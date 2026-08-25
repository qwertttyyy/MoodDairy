import { createContext, useContext } from 'react'

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

export const EntryModalContext = createContext<EntryModalValue | null>(null)

export function useEntryModal(): EntryModalValue {
  const value = useContext(EntryModalContext)
  if (!value) throw new Error('useEntryModal должен вызываться внутри EntryModalProvider')
  return value
}
