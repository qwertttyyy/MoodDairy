import { useSyncExternalStore } from 'react'

import { api, ApiError, isRetryableError } from '../../shared/api/client'
import {
  groupedEntriesResponseSchema,
  rawEntrySchema,
  snapshotRawEntriesSchema,
} from '../../shared/api/types'
import type { RawEntry, Tag } from '../../shared/api/types'
import {
  currentOfflineUser,
  offlineSessionGeneration,
  keysForUser,
  setOfflineState,
  storeForUser,
} from '../../shared/offline/offline'
import { readSealed, removeValue } from '../../shared/offline/storage'

export interface EntryBody {
  mood: string
  anxiety: string
  note: string
  timestamp: string
  tags: number[]
}

export interface PendingEntry {
  id: number
  queueId: string
  body: EntryBody
  tags: Tag[]
  state: 'pending' | 'sending' | 'failed'
  error: string
}

let pending: PendingEntry[] = []
let pendingUser: number | null = null
const listeners = new Set<() => void>()
let running: Promise<void> | null = null
let syncController: AbortController | null = null
let nextRun: { onSynced: SyncedHandler; verifySession: () => Promise<boolean> } | null = null

function changed(): void {
  window.dispatchEvent(new Event('moods-outbox-changed'))
}

export class OfflineStorageError extends Error {
  constructor(cause: unknown) {
    super(
      'Не удалось сохранить запись на устройстве. Проверьте свободное место и разрешения браузера.',
      { cause },
    )
    this.name = 'OfflineStorageError'
  }
}

function publish(entries: PendingEntry[]): void {
  if (
    pendingUser === (currentOfflineUser()?.id ?? null) &&
    JSON.stringify(entries) === JSON.stringify(pending)
  )
    return
  pending = entries
  pendingUser = currentOfflineUser()?.id ?? null
  setOfflineState({ pending: entries.length })
  listeners.forEach((listener) => listener())
}

export function usePendingEntries(): PendingEntry[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => pending,
  )
}

export async function loadPendingEntries(): Promise<void> {
  const userId = currentOfflineUser()?.id
  const version = offlineSessionGeneration()
  const keys = await keysForUser('outbox:')
  const entries = await Promise.all(keys.map((key) => readSealed<PendingEntry>(key)))
  if (currentOfflineUser()?.id !== userId || offlineSessionGeneration() !== version) return
  publish(
    entries.filter((entry): entry is PendingEntry => Boolean(entry)).sort((a, b) => b.id - a.id),
  )
}

export function resetPendingEntries(): void {
  syncController?.abort()
  nextRun = null
  publish([])
}

export async function queueEntry(body: EntryBody, tags: Tag[]): Promise<RawEntry> {
  const userId = currentOfflineUser()?.id
  if (!userId) throw new Error('Войдите снова перед сохранением записи')
  const entry: PendingEntry = {
    id: -(Date.now() * 1000 + ((crypto.getRandomValues(new Uint16Array(1))[0] ?? 0) % 1000)),
    queueId: crypto.randomUUID(),
    body,
    tags,
    state: 'pending',
    error: '',
  }
  try {
    await storeForUser(`outbox:${entry.queueId}`, entry)
  } catch (error) {
    if (currentOfflineUser()?.id !== userId) throw error
    setOfflineState({ storageError: true })
    throw new OfflineStorageError(error)
  }
  if (currentOfflineUser()?.id !== userId)
    throw new Error('Аккаунт изменился. Запись не отправлена.')
  await loadPendingEntries().catch(() => publish([...pending, entry]))
  changed()
  return pendingAsRaw(entry)
}

export async function editPendingEntry(
  id: number,
  body?: EntryBody,
  tags: Tag[] = [],
): Promise<RawEntry | undefined> {
  if (!navigator.locks) throw new Error('Изменение локальной записи недоступно в этом браузере')
  const userId = currentOfflineUser()?.id
  return navigator.locks.request('moods-outbox-sync', async () => {
    await loadPendingEntries()
    const item = pending.find((entry) => entry.id === id)
    if (!item || userId !== currentOfflineUser()?.id)
      throw new Error('Запись уже отправлена. Откройте её снова из ленты.')
    if (item.state === 'sending')
      throw new Error(
        'Доставка записи ещё проверяется. Подключитесь к интернету и дождитесь синхронизации.',
      )
    if (body) {
      const selectedTags = body.tags.flatMap((id) => {
        const tag =
          tags.find((value) => value.id === id) ?? item.tags.find((value) => value.id === id)
        return tag ? [tag] : []
      })
      const updated: PendingEntry = {
        ...item,
        body,
        tags: selectedTags,
        state: 'pending',
        error: '',
      }
      await storeForUser(`outbox:${item.queueId}`, updated)
      await loadPendingEntries()
      changed()
      return pendingAsRaw(updated)
    }
    await removeValue(`user:${userId}:outbox:${item.queueId}`)
    await loadPendingEntries()
    return undefined
  })
}

export async function retryPendingEntries(): Promise<void> {
  if (!navigator.locks) return
  await navigator.locks.request('moods-outbox-sync', async () => {
    await loadPendingEntries()
    for (const item of pending) {
      if (item.state === 'failed')
        await storeForUser(`outbox:${item.queueId}`, { ...item, state: 'pending', error: '' })
    }
    await loadPendingEntries()
  })
  changed()
}

export function pendingAsRaw(entry: PendingEntry): RawEntry {
  return { ...entry.body, id: entry.id, tags: entry.tags }
}

type SyncedHandler = (entry: RawEntry) => Promise<void>

/** One writer per origin. A persisted sending state survives process termination. */
export function syncPendingEntries(
  onSynced: SyncedHandler,
  verifySession: () => Promise<boolean>,
): Promise<void> {
  if (running) {
    nextRun = { onSynced, verifySession }
    return running
  }
  running = (async () => {
    if (!navigator.onLine || !currentOfflineUser()) return
    const run = async () => {
      await loadPendingEntries()
      if (!pending.some((entry) => entry.state !== 'failed')) return
      if (!(await verifySession())) return
      const userId = currentOfflineUser()?.id
      const version = offlineSessionGeneration()
      if (!userId) return
      const controller = new AbortController()
      syncController = controller
      setOfflineState({ syncing: true, error: '' })
      try {
        await loadPendingEntries()
        // Reload while holding the cross-tab lock; another tab may have sent these.
        for (const item of [...pending].reverse()) {
          if (
            controller.signal.aborted ||
            currentOfflineUser()?.id !== userId ||
            offlineSessionGeneration() !== version
          )
            return
          if (item.state === 'failed') continue
          const key = `user:${userId}:outbox:${item.queueId}`
          let rejectedByServer = false
          try {
            if (item.state === 'sending') {
              // A lost POST response is ambiguous. Check its exact ciphertext before retrying.
              const existing = await api.get('/api/entries/snapshot/', snapshotRawEntriesSchema, {
                signal: controller.signal,
              })
              if (
                existing.some(
                  (entry) =>
                    Date.parse(entry.timestamp) === Date.parse(item.body.timestamp) &&
                    entry.mood === item.body.mood &&
                    entry.note === item.body.note &&
                    entry.anxiety === item.body.anxiety,
                )
              ) {
                const upper = new Date(item.body.timestamp)
                upper.setUTCDate(upper.getUTCDate() + 2)
                const page = await api.get(
                  `/api/entries/grouped/?before=${upper.toISOString().slice(0, 10)}`,
                  groupedEntriesResponseSchema,
                  { signal: controller.signal },
                )
                const confirmed = Object.values(page.results)
                  .flat()
                  .find(
                    (entry) =>
                      Date.parse(entry.timestamp) === Date.parse(item.body.timestamp) &&
                      entry.mood === item.body.mood &&
                      entry.note === item.body.note &&
                      entry.anxiety === item.body.anxiety,
                  )
                if (!confirmed)
                  throw new Error(
                    'Запись получена сервером. Не удалось обновить её локальную копию; повторите синхронизацию.',
                  )
                await onSynced(confirmed)
                if (controller.signal.aborted || currentOfflineUser()?.id !== userId) return
                await removeValue(key)
                await loadPendingEntries()
                continue
              }
            }
            await storeForUser(`outbox:${item.queueId}`, { ...item, state: 'sending' })
            const result = await api
              .post('/api/entries/', item.body, rawEntrySchema, {
                signal: controller.signal,
              })
              .catch((error: unknown) => {
                rejectedByServer =
                  error instanceof ApiError && error.status >= 400 && error.status < 500
                throw error
              })
            if (controller.signal.aborted || currentOfflineUser()?.id !== userId) return
            await onSynced(result)
            if (controller.signal.aborted || currentOfflineUser()?.id !== userId) return
            await removeValue(key)
            setOfflineState({ connected: true })
            await loadPendingEntries()
          } catch (error) {
            if (
              controller.signal.aborted ||
              currentOfflineUser()?.id !== userId ||
              offlineSessionGeneration() !== version
            )
              return
            const message = error instanceof Error ? error.message : 'Не удалось отправить запись'
            // Only a definitive POST rejection allows changing and resending the
            // payload. Storage/decoding failures after acceptance remain ambiguous.
            if (rejectedByServer) {
              await storeForUser(`outbox:${item.queueId}`, {
                ...item,
                state: 'failed',
                error: message,
              })
            }
            setOfflineState({ connected: !isRetryableError(error), error: message })
            await loadPendingEntries()
            return
          }
        }
      } finally {
        if (syncController === controller) syncController = null
        setOfflineState({ syncing: false })
      }
    }
    // Web Locks serializes sending across PWA and browser tabs. Without it keep
    // local data and require a supporting browser instead of risking duplicates.
    if (navigator.locks) await navigator.locks.request('moods-outbox-sync', run)
    else
      setOfflineState({
        error:
          'Автоматическая отправка недоступна в этом браузере. Записи сохранены на устройстве.',
      })
  })()
    .catch((error: unknown) => {
      setOfflineState({
        error: error instanceof Error ? error.message : 'Не удалось синхронизировать записи',
      })
    })
    .finally(() => {
      running = null
      const next = nextRun
      nextRun = null
      if (next) void syncPendingEntries(next.onSynced, next.verifySession)
    })
  return running
}

export function pendingBelongsToCurrentUser(): boolean {
  return pendingUser === (currentOfflineUser()?.id ?? null)
}
