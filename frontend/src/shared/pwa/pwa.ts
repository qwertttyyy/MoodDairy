import { createContext, useContext } from 'react'

export type InstallResult = 'accepted' | 'dismissed' | 'unavailable'

export interface PwaContextValue {
  canInstall: boolean
  isIos: boolean
  isStandalone: boolean
  installPending: boolean
  promptInstall: () => Promise<InstallResult>
}

export const PwaContext = createContext<PwaContextValue | null>(null)

export function usePwa(): PwaContextValue {
  const value = useContext(PwaContext)
  if (!value) throw new Error('usePwa должен вызываться внутри PwaProvider')
  return value
}
