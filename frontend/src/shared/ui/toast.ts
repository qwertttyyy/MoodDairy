import { createContext, useContext } from 'react'

export type ShowToast = (message: string, isError?: boolean) => void

export const ToastContext = createContext<ShowToast | null>(null)

export function useToast(): ShowToast {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast должен вызываться внутри ToastProvider')
  return show
}
