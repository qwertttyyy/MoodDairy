import { createContext, useContext } from 'react'

import type { AuthUser } from '../../shared/api/types'

export type AuthStatus = 'loading' | 'anon' | 'authed'

export interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth должен вызываться внутри AuthProvider')
  return value
}
