import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import {
  ApiError,
  ERROR_CODES,
  IncompatibleApiResponseError,
  NetworkError,
  REQUEST_TIMEOUTS,
  RequestTimeoutError,
  api,
  setNotAuthenticatedHandler,
} from '../../shared/api/client'
import {
  appConfigSchema,
  authResponseSchema,
  authUserSchema,
  profileResponseSchema,
  voidResponseSchema,
  wrappingKeyResponseSchema,
} from '../../shared/api/types'
import type { AuthUser } from '../../shared/api/types'
import {
  clearKeys,
  clearSessionKey,
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

class EncryptionBootstrapError extends Error {
  constructor(cause: unknown) {
    super('Не удалось подготовить локальное шифрование', { cause })
    this.name = 'EncryptionBootstrapError'
  }
}

/** Сессия, проверенная конфигурация и жизненный цикл локального ключа. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [startupError, setStartupError] = useState<Error | null>(null)
  const [sessionMessage, setSessionMessage] = useState('')
  const bootstrapController = useRef<AbortController | null>(null)

  const retryBootstrap = useCallback(() => {
    bootstrapController.current?.abort()
    const controller = new AbortController()
    bootstrapController.current = controller
    setStatus('loading')
    setStartupError(null)

    const run = async () => {
      try {
        const config = await api.get('/api/config/', appConfigSchema, {
          signal: controller.signal,
          timeoutMs: REQUEST_TIMEOUTS.bootstrap,
        })
        setEncryptionEnabled(config.encryption_enabled)

        const restored = await tryRestore(controller.signal)
        if (controller.signal.aborted) return
        setUser(restored)
        setStatus(restored ? 'authed' : 'anon')
      } catch (error) {
        if (controller.signal.aborted) return
        const failure = error instanceof Error ? error : new Error('Неизвестная ошибка запуска')
        setStartupError(failure)
        setUser(null)
        setStatus(classifyStartupFailure(error))
      }
    }

    void run()
  }, [])

  useEffect(() => {
    retryBootstrap()
    return () => bootstrapController.current?.abort()
  }, [retryBootstrap])

  useEffect(
    () =>
      setNotAuthenticatedHandler(() => {
        clearSessionKey()
        queryClient.clear()
        setUser(null)
        if (status === 'authed') {
          setSessionMessage('Сессия закончилась, войдите снова')
        }
        setStatus('anon')
      }),
    [queryClient, status],
  )

  const register = useCallback(async (username: string, password: string) => {
    let salt = ''
    try {
      if (isEncryptionEnabled()) {
        salt = generateSalt()
        storeFromDerived(await deriveKey(password, salt))
      }

      const data = await api.post(
        '/api/auth/register/',
        { username, password, encryption_salt: salt },
        authResponseSchema,
      )
      try {
        if (isEncryptionEnabled()) await wrapKey(data.wrapping_key)
      } catch (error) {
        await rollbackAuthenticatedSession()
        throw new EncryptionBootstrapError(error)
      }

      setSessionMessage('')
      setUser({ id: data.id, username: data.username })
      setStatus('authed')
    } catch (error) {
      clearSessionKey()
      throw error
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.post('/api/auth/login/', { username, password }, authResponseSchema)

    try {
      if (isEncryptionEnabled()) {
        const profile = await api.get('/api/auth/profile/', profileResponseSchema)
        storeFromDerived(await deriveKey(password, profile.encryption_salt))
        await wrapKey(data.wrapping_key)
      }
    } catch (error) {
      await rollbackAuthenticatedSession()
      throw new EncryptionBootstrapError(error)
    }

    setSessionMessage('')
    setUser({ id: data.id, username: data.username })
    setStatus('authed')
  }, [])

  const logout = useCallback(async () => {
    clearKeys()
    await endServerSession()
    queryClient.clear()
    setSessionMessage('')
    setUser(null)
    setStatus('anon')
  }, [queryClient])

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        startupError,
        sessionMessage,
        retryBootstrap,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

async function tryRestore(signal: AbortSignal): Promise<AuthUser | null> {
  let me: AuthUser
  try {
    me = await api.get('/api/auth/me/', authUserSchema, { signal })
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.code === ERROR_CODES.notAuthenticated)
    ) {
      return null
    }
    throw error
  }

  if (!isEncryptionEnabled() || hasKey()) return me
  if (!hasWrapped()) {
    await endServerSession(signal)
    return null
  }

  try {
    const { wrapping_key } = await api.get('/api/auth/unwrap-key/', wrappingKeyResponseSchema, {
      signal,
    })
    await unwrapKey(wrapping_key)
    return me
  } catch (error) {
    clearSessionKey()
    await endServerSession(signal)
    throw new EncryptionBootstrapError(error)
  }
}

function classifyStartupFailure(error: unknown): AuthStatus {
  if (!navigator.onLine) return 'offline'
  if (error instanceof IncompatibleApiResponseError || error instanceof EncryptionBootstrapError) {
    return 'invalid-config'
  }
  if (
    error instanceof NetworkError ||
    error instanceof RequestTimeoutError ||
    error instanceof ApiError
  ) {
    return 'server-unavailable'
  }
  return 'invalid-config'
}

async function rollbackAuthenticatedSession(): Promise<void> {
  clearKeys()
  await endServerSession()
}

async function endServerSession(signal?: AbortSignal): Promise<void> {
  try {
    await api.post('/api/auth/logout/', {}, voidResponseSchema, signal ? { signal } : undefined)
  } catch {
    // Локальное состояние сбрасывается независимо от доступности сервера.
  }
}
