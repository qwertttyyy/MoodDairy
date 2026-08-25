import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { EntryModalContext } from './EntryModalContext'
import type { DecryptedEntry } from './types'

/** Состояние формы доступно памятке, которая может выставлять оценку. */
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
