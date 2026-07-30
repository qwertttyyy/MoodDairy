import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type GuideTab = 'mood' | 'anxiety'

interface GuideValue {
  isOpen: boolean
  tab: GuideTab
  open: (tab?: GuideTab) => void
  close: () => void
  setTab: (tab: GuideTab) => void
}

const GuideContext = createContext<GuideValue | null>(null)

export function useGuide(): GuideValue {
  const value = useContext(GuideContext)
  if (!value) throw new Error('useGuide должен вызываться внутри GuideProvider')
  return value
}

/** Памятка по шкалам. Открывается из шапки и из формы записи. */
export function GuideProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [tab, setTab] = useState<GuideTab>('mood')

  const open = useCallback((next: GuideTab = 'mood') => {
    setTab(next)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => setIsOpen(false), [])

  const value = useMemo(() => ({ isOpen, tab, open, close, setTab }), [isOpen, tab, open, close])

  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>
}
