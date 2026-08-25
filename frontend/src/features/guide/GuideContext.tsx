import { createContext, useContext } from 'react'

export type GuideTab = 'mood' | 'anxiety'

interface GuideValue {
  isOpen: boolean
  tab: GuideTab
  open: (tab?: GuideTab) => void
  close: () => void
  setTab: (tab: GuideTab) => void
}

export const GuideContext = createContext<GuideValue | null>(null)

export function useGuide(): GuideValue {
  const value = useContext(GuideContext)
  if (!value) throw new Error('useGuide должен вызываться внутри GuideProvider')
  return value
}
