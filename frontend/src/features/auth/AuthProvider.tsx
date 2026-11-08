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
  isRetryableError,
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
  hasKeyForUser,
  hasWrapped,
  isEncryptionEnabled,
  setEncryptionEnabled,
  storeFromDerived,
  unwrapKey,
  wrapKey,
  bindKeyToUser,
  wrappedKeyMatchesUser,
} from '../../shared/crypto/crypto'
import {
  activateOfflineUser,
  forgetOfflineData,
  rememberOfflineSession,
  restoreOfflineSession,
  setOfflineState,
} from '../../shared/offline/offline'
import { AuthContext } from './AuthContext'
import type { AuthStatus } from './AuthContext'
import { resetVaultKey } from '../../shared/offline/storage'

class EncryptionBootstrapError extends Error {
  constructor(cause: unknown) {
    super('Не удалось подготовить локальное шифрование', { cause })
    this.name = 'EncryptionBootstrapError'
  }
}

// An offline logout cannot clear the HttpOnly server cookie. Keep the diary
// locked across restarts until a deliberate login, and end that session online.
const LOCAL_LOGOUT_STORAGE = 'moods_local_logout'
const SESSION_SOURCE = crypto.randomUUID()

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
    activateOfflineUser(null)
    queryClient.clear()
    const controller = new AbortController()
    bootstrapController.current = controller
    setStatus('loading')
    setStartupError(null)

    const run = async () => {
      const deadline = new AbortController()
      const abort = () => deadline.abort()
      controller.signal.addEventListener('abort', abort, { once: true })
      let timedOut = false
      let observedUser: AuthUser | null | undefined
      const timer = window.setTimeout(() => {
        timedOut = true
        deadline.abort()
      }, REQUEST_TIMEOUTS.bootstrap)
      try {
        const locallyLoggedOut = localStorage.getItem(LOCAL_LOGOUT_STORAGE) === 'true'
        if (locallyLoggedOut && !navigator.onLine) {
          setUser(null)
          setStatus('anon')
          return
        }
        if (!navigator.onLine) {
          const cached = await restoreOfflineSession(controller.signal)
          if (controller.signal.aborted) return
          if (cached) {
            setUser(cached)
            setStatus('authed')
            return
          }
          throw new NetworkError(new Error('offline'))
        }
        const [config, me] = await Promise.all([
          api.get('/api/config/', appConfigSchema, { signal: deadline.signal }),
          (locallyLoggedOut
            ? api
                .post('/api/auth/logout/', {}, voidResponseSchema, { signal: deadline.signal })
                .then(() => null)
            : loadCurrentUser(deadline.signal)
          ).then((me) => {
            observedUser = me
            return me
          }),
        ])
        if (controller.signal.aborted) return
        setEncryptionEnabled(config.encryption_enabled)

        const restored = me ? await tryRestore(me, deadline.signal) : null
        if (controller.signal.aborted) return
        activateOfflineUser(restored)
        setOfflineState({ connected: true })
        if (restored)
          void rememberOfflineSession(restored).catch(() => setOfflineState({ storageError: true }))
        setUser(restored)
        setStatus(restored ? 'authed' : 'anon')
      } catch (error) {
        if (controller.signal.aborted) return
        const failure = timedOut
          ? new RequestTimeoutError(REQUEST_TIMEOUTS.bootstrap)
          : error instanceof Error
            ? error
            : new Error('Неизвестная ошибка запуска')
        if (isRetryableError(failure) && localStorage.getItem(LOCAL_LOGOUT_STORAGE) !== 'true') {
          const cached = await restoreOfflineSession(
            controller.signal,
            observedUser === undefined ? undefined : (observedUser?.id ?? null),
          )
          if (controller.signal.aborted) return
          if (cached) {
            setUser(cached)
            setStatus('authed')
            return
          }
        }
        setStartupError(failure)
        setUser(null)
        setStatus(classifyStartupFailure(failure))
      } finally {
        window.clearTimeout(timer)
        controller.signal.removeEventListener('abort', abort)
        deadline.abort()
      }
    }

    void run()
  }, [queryClient])

  useEffect(() => {
    retryBootstrap()
    return () => bootstrapController.current?.abort()
  }, [retryBootstrap])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel('moods-session')
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data as { source?: string; type?: string } | null
      if (message?.source === SESSION_SOURCE) return
      const type = typeof event.data === 'string' ? event.data : message?.type
      if (type !== 'lock' && type !== 'changed') return
      bootstrapController.current?.abort()
      clearSessionKey()
      resetVaultKey()
      activateOfflineUser(null)
      queryClient.clear()
      setUser(null)
      if (type === 'changed') retryBootstrap()
      else setStatus('anon')
    }
    return () => channel.close()
  }, [queryClient, retryBootstrap])

  useEffect(
    () =>
      setNotAuthenticatedHandler(() => {
        if (status === 'loading') return
        bootstrapController.current?.abort()
        clearSessionKey()
        activateOfflineUser(null)
        queryClient.clear()
        setUser(null)
        if (status === 'authed') {
          setSessionMessage('Сессия закончилась, войдите снова')
        }
        setStatus('anon')
      }),
    [queryClient, status],
  )

  const register = useCallback(
    async (username: string, password: string) => {
      if (password !== password.trim())
        throw new Error('Пароль не должен начинаться или заканчиваться пробелом')
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
          if (isEncryptionEnabled()) {
            await wrapKey(data.wrapping_key)
            bindKeyToUser(data.id)
          }
        } catch (error) {
          await rollbackAuthenticatedSession()
          throw new EncryptionBootstrapError(error)
        }

        setSessionMessage('')
        localStorage.removeItem(LOCAL_LOGOUT_STORAGE)
        queryClient.clear()
        activateOfflineUser({ id: data.id, username: data.username })
        void rememberOfflineSession({ id: data.id, username: data.username }).catch(() =>
          setOfflineState({ storageError: true }),
        )
        setUser({ id: data.id, username: data.username })
        setStatus('authed')
        broadcastSession('changed')
      } catch (error) {
        clearSessionKey()
        throw error
      }
    },
    [queryClient],
  )

  const login = useCallback(
    async (username: string, password: string) => {
      const data = await api.post('/api/auth/login/', { username, password }, authResponseSchema)

      try {
        if (isEncryptionEnabled()) {
          const profile = await api.get('/api/auth/profile/', profileResponseSchema)
          storeFromDerived(await deriveKey(password, profile.encryption_salt))
          await wrapKey(data.wrapping_key)
          bindKeyToUser(data.id)
        }
      } catch (error) {
        await rollbackAuthenticatedSession()
        throw new EncryptionBootstrapError(error)
      }

      setSessionMessage('')
      localStorage.removeItem(LOCAL_LOGOUT_STORAGE)
      queryClient.clear()
      activateOfflineUser({ id: data.id, username: data.username })
      void rememberOfflineSession({ id: data.id, username: data.username }).catch(() =>
        setOfflineState({ storageError: true }),
      )
      setUser({ id: data.id, username: data.username })
      setStatus('authed')
      broadcastSession('changed')
    },
    [queryClient],
  )

  const logout = useCallback(async () => {
    localStorage.setItem(LOCAL_LOGOUT_STORAGE, 'true')
    broadcastSession('lock')
    bootstrapController.current?.abort()
    activateOfflineUser(null)
    await queryClient.cancelQueries()
    await forgetOfflineData().catch(() => setOfflineState({ storageError: true }))
    clearKeys()
    if (navigator.onLine) await endServerSession()
    queryClient.clear()
    setSessionMessage('')
    setUser(null)
    setStatus('anon')
    broadcastSession('changed')
  }, [queryClient])

  const lock = useCallback(() => {
    bootstrapController.current?.abort()
    clearSessionKey()
    activateOfflineUser(null)
    queryClient.clear()
    setUser(null)
    setSessionMessage('Войдите заново, чтобы разблокировать дневник')
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
        lock,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

function broadcastSession(message: 'lock' | 'changed'): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel('moods-session')
  channel.postMessage({ source: SESSION_SOURCE, type: message })
  channel.close()
}

async function loadCurrentUser(signal: AbortSignal): Promise<AuthUser | null> {
  try {
    return await api.get('/api/auth/me/', authUserSchema, { signal })
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.code === ERROR_CODES.notAuthenticated)
    ) {
      return null
    }
    throw error
  }
}

async function tryRestore(me: AuthUser, signal: AbortSignal): Promise<AuthUser | null> {
  if (!isEncryptionEnabled() || hasKeyForUser(me.id)) return me
  clearSessionKey()
  if (!hasWrapped() || !wrappedKeyMatchesUser(me.id)) {
    return null
  }

  try {
    const { wrapping_key } = await api.get('/api/auth/unwrap-key/', wrappingKeyResponseSchema, {
      signal,
    })
    if (!(await unwrapKey(wrapping_key, signal))) return null
    if (signal.aborted) return null
    bindKeyToUser(me.id)
    return me
  } catch (error) {
    if (signal.aborted || isRetryableError(error)) throw error
    clearSessionKey()
    // A different account or an unreadable local key requires unlocking,
    // not destroying a valid server session.
    return null
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
