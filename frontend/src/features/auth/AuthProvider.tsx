import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { api } from '../../shared/api/client'
import type {
  AppConfig,
  AuthResponse,
  AuthUser,
  ProfileResponse,
  WrappingKeyResponse,
} from '../../shared/api/types'
import {
  clearKeys,
  deriveKey,
  generateSalt,
  hasKey,
  hasWrapped,
  isEncryptionEnabled,
  setEncryptionEnabled,
  storeFromDerived,
  unwrapKey,
  wrapKey,
} from '../../shared/crypto/crypto'
import { AuthContext } from './AuthContext'
import type { AuthStatus } from './AuthContext'

/**
 * Сессия и ключ шифрования.
 *
 * Старт приложения: `GET /api/config/` (флаг шифрования + CSRF-cookie) →
 * попытка восстановить сессию (`/me/`, при необходимости `unwrap-key`).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        const config = await api.get<AppConfig>('/api/config/')
        setEncryptionEnabled(config.encryption_enabled)
      } catch {
        // Недоступный конфиг не должен блокировать вход: остаётся значение по умолчанию.
      }

      const restored = await tryRestore()
      if (cancelled) return
      setUser(restored)
      setStatus(restored ? 'authed' : 'anon')
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  const register = useCallback(async (username: string, password: string) => {
    let salt = ''
    if (isEncryptionEnabled()) {
      salt = generateSalt()
      storeFromDerived(await deriveKey(password, salt))
    }

    const data = await api.post<AuthResponse>('/api/auth/register/', {
      username,
      password,
      encryption_salt: salt,
    })

    if (isEncryptionEnabled()) await wrapKey(data.wrapping_key)
    setUser({ id: data.id, username: data.username })
    setStatus('authed')
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.post<AuthResponse>('/api/auth/login/', { username, password })

    if (isEncryptionEnabled()) {
      const profile = await api.get<ProfileResponse>('/api/auth/profile/')
      storeFromDerived(await deriveKey(password, profile.encryption_salt))
      await wrapKey(data.wrapping_key)
    }

    setUser({ id: data.id, username: data.username })
    setStatus('authed')
  }, [])

  const logout = useCallback(async () => {
    clearKeys()
    try {
      await api.post('/api/auth/logout/', {})
    } catch {
      // Сессия могла истечь — локальное состояние всё равно сбрасываем.
    }
    queryClient.clear()
    setUser(null)
    setStatus('anon')
  }, [queryClient])

  return (
    <AuthContext.Provider value={{ status, user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

/**
 * Восстановление сессии после перезагрузки страницы.
 * Порт Auth.tryRestore: сессия есть → ключ в sessionStorage? → развернуть обёрнутый ключ.
 */
async function tryRestore(): Promise<AuthUser | null> {
  let me: AuthUser
  try {
    me = await api.get<AuthUser>('/api/auth/me/')
  } catch {
    return null
  }

  if (!isEncryptionEnabled() || hasKey()) return me
  if (!hasWrapped()) return null

  try {
    const { wrapping_key } = await api.get<WrappingKeyResponse>('/api/auth/unwrap-key/')
    await unwrapKey(wrapping_key)
    return me
  } catch {
    return null
  }
}
