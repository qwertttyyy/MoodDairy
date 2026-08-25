import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { GuideContext } from './GuideContext'
import type { GuideTab } from './GuideContext'

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
