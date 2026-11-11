import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api } from '../../shared/api/client'
import { authUserSchema } from '../../shared/api/types'
import {
  currentOfflineUser,
  diaryWritesBlocked,
  setOfflineState,
} from '../../shared/offline/offline'
import { useSyncFeedback } from '../../shared/offline/useSyncFeedback'
import { useAuth } from '../auth/AuthContext'
import { applySavedEntry } from './api'
import { patchCachedFeed } from './feedCache'
import {
  loadPendingEntries,
  resetPendingEntries,
  retryPendingEntries,
  syncPendingEntries,
} from './offlineEntries'

export function EntrySync() {
  const { user, retryBootstrap } = useAuth()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!user) return
    let disposed = false
    const sync = () => {
      if (disposed) return
      void syncPendingEntries(
        async (entry, localId) => {
          if (disposed || currentOfflineUser()?.id !== user.id)
            throw new DOMException('Сессия изменилась', 'AbortError')
          await queryClient.cancelQueries({ queryKey: ['entries', 'feed'] })
          if (disposed || currentOfflineUser()?.id !== user.id)
            throw new DOMException('Сессия изменилась', 'AbortError')
          await patchCachedFeed(entry)
          await applySavedEntry(queryClient, entry, user.id, localId)
        },
        async () => {
          if (disposed || diaryWritesBlocked()) return false
          const me = await api.get('/api/auth/me/', authUserSchema, { timeoutMs: 12000 })
          if (disposed) return false
          if (me.id !== currentOfflineUser()?.id || me.id !== user.id) {
            retryBootstrap()
            return false
          }
          return true
        },
      )
    }
    const resume = () => {
      if (document.visibilityState === 'hidden') return
      setOfflineState({ connected: navigator.onLine })
      sync()
      if (navigator.onLine) void queryClient.refetchQueries({ type: 'active', stale: true })
    }
    const offline = () => setOfflineState({ connected: false })
    void loadPendingEntries()
      .then(sync)
      .catch(() => setOfflineState({ storageError: true }))
    window.addEventListener('online', resume)
    window.addEventListener('offline', offline)
    window.addEventListener('pageshow', resume)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('moods-outbox-changed', sync)
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') sync()
    }, 30_000)
    return () => {
      disposed = true
      resetPendingEntries()
      window.clearInterval(interval)
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', offline)
      window.removeEventListener('pageshow', resume)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('moods-outbox-changed', sync)
    }
  }, [user, queryClient, retryBootstrap])
  return null
}

export function OfflineNotice() {
  const { connected, syncing, pending, error, storageError, writeBlocked, showPending } =
    useSyncFeedback()
  const { lock } = useAuth()
  if (connected && !showPending && !error && !storageError && !writeBlocked) return null
  return (
    <aside className="offline-notice" aria-label="Состояние синхронизации">
      <p role="status">
        {storageError
          ? 'Локальное хранилище недоступно'
          : writeBlocked
            ? 'Дневник нужно разблокировать'
            : !connected
              ? 'Нет связи · дневник на устройстве'
              : syncing
                ? 'Отправляем записи…'
                : 'Есть записи на устройстве'}
      </p>
      {pending > 0 && (
        <p className="offline-detail">
          Ожидают отправки: {pending}. До отправки они доступны только на этом устройстве.
        </p>
      )}
      {storageError && (
        <p className="offline-detail">
          Оффлайн-сохранение недоступно. Проверьте свободное место и разрешения браузера.
        </p>
      )}
      {error && <p className="offline-detail">{error}</p>}
      {writeBlocked && (
        <>
          <p className="offline-detail">
            Записи не удалось прочитать. Чтобы безопасно добавлять новые, войдите заново с паролем
            дневника. Локальные записи сохранятся.
          </p>
          <button type="button" className="btn-plain" onClick={lock}>
            Войти заново
          </button>
        </>
      )}
      {navigator.onLine && (pending > 0 || !connected) && (
        <button
          type="button"
          className="btn-plain"
          disabled={syncing}
          onClick={() => {
            void retryPendingEntries().then(() => window.dispatchEvent(new Event('online')))
          }}
        >
          Повторить синхронизацию
        </button>
      )}
    </aside>
  )
}
