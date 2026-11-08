import { useSyncExternalStore } from 'react'
import { parse } from 'zod/v4/core'
import type { $ZodType } from 'zod/v4/core'

import { api, isRetryableError, NetworkError } from '../api/client'
import type { RequestOptions } from '../api/client'
import type { AuthUser } from '../api/types'
import {
  getLocalEncryptionKey,
  isEncryptionEnabled,
  restoreLocalEncryptionKey,
  setEncryptionEnabled,
} from '../crypto/crypto'
import { clearVault, listKeys, readSealed, readValue, seal, writeValue } from './storage'

interface OfflineState {
  connected: boolean
  syncing: boolean
  pending: number
  error: string
  storageError: boolean
  writeBlocked: boolean
}

let state: OfflineState = {
  connected: navigator.onLine,
  syncing: false,
  pending: 0,
  error: '',
  storageError: false,
  writeBlocked: false,
}
const listeners = new Set<() => void>()
let activeUser: AuthUser | null = null
let generation = 0

export function setOfflineState(patch: Partial<OfflineState>): void {
  if (Object.entries(patch).every(([key, value]) => state[key as keyof OfflineState] === value))
    return
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

export function useOfflineState(): OfflineState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => state,
  )
}

export function currentOfflineUser(): AuthUser | null {
  return activeUser
}

export function offlineSessionGeneration(): number {
  return generation
}

export function activateOfflineUser(user: AuthUser | null): void {
  if (activeUser?.id !== user?.id) {
    generation++
    setOfflineState({ pending: 0, syncing: false, error: '', writeBlocked: false })
  }
  activeUser = user
}

export function diaryWritesBlocked(): boolean {
  return state.writeBlocked
}

export async function storeForUser(
  key: string,
  data: unknown,
  signal?: AbortSignal,
): Promise<void> {
  const user = activeUser
  const version = generation
  if (!user) throw new Error('Аккаунт не разблокирован')
  const encrypted = await seal(data, `user:${user.id}:${key}`)
  signal?.throwIfAborted()
  if (version !== generation) throw new Error('Аккаунт изменился во время сохранения')
  await writeValue(`user:${user.id}:${key}`, encrypted)
}

export function readForUser<T>(key: string): Promise<T | undefined> {
  return activeUser ? readSealed<T>(`user:${activeUser.id}:${key}`) : Promise.resolve(undefined)
}

export function keysForUser(prefix: string): Promise<string[]> {
  return activeUser ? listKeys(`user:${activeUser.id}:${prefix}`) : Promise.resolve([])
}

export async function rememberOfflineSession(user: AuthUser): Promise<void> {
  const version = generation
  const key = isEncryptionEnabled() ? await getLocalEncryptionKey() : null
  const session = await seal({ user, encryptionEnabled: isEncryptionEnabled() }, 'session')
  if (version !== generation || activeUser?.id !== user.id) return
  // Identity and its non-extractable key are committed in one IDB transaction.
  await writeValue('session', { ...session, userId: user.id, key })
  setOfflineState({ storageError: false })
}

export async function restoreOfflineSession(
  signal?: AbortSignal,
  expectedUserId?: number | null,
): Promise<AuthUser | null> {
  try {
    const session = await readSealed<{ user: AuthUser; encryptionEnabled: boolean }>('session')
    if (!session) return null
    if (expectedUserId !== undefined && session.user.id !== expectedUserId) return null
    const record = await readValue<{ userId: number; key: CryptoKey | null }>('session')
    if (record?.userId !== session.user.id || (session.encryptionEnabled && !record.key))
      return null
    if (signal?.aborted) return null
    setEncryptionEnabled(session.encryptionEnabled)
    if (record?.key) restoreLocalEncryptionKey(record.key, session.user.id)
    activateOfflineUser(session.user)
    setOfflineState({ connected: false })
    return session.user
  } catch {
    return null
  }
}

export async function forgetOfflineData(): Promise<void> {
  activateOfflineUser(null)
  await clearVault()
}

/** Never falls back for 401/403 or validation errors. Those must lock the diary. */
export async function cachedGet<T>(
  url: string,
  schema: $ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const version = generation
  try {
    if (!navigator.onLine) throw new NetworkError(new Error('offline'))
    const data = await api.get(url, schema, options)
    if (version === generation) {
      setOfflineState({ connected: true })
      await storeForUser(`cache:${url}`, data, options.signal).catch(() => {
        if (!options.signal?.aborted) setOfflineState({ storageError: true })
      })
    }
    return data
  } catch (error) {
    if (options.signal?.aborted || version !== generation || !isRetryableError(error)) throw error
    setOfflineState({ connected: false })
    const cached = await readForUser<unknown>(`cache:${url}`).catch(() => undefined)
    if (options.signal?.aborted || version !== generation) throw error
    if (cached === undefined) throw error
    return parse(schema, cached)
  }
}
