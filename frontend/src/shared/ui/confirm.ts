import { createContext, useContext } from 'react'

export interface ConfirmRequest {
  title: string
  text: string
  onConfirm: () => void
  confirmLabel?: string
}

export type Confirm = (request: ConfirmRequest) => void

export const ConfirmContext = createContext<Confirm | null>(null)

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm должен вызываться внутри ConfirmProvider')
  return confirm
}
