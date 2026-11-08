import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { localDateKey } from '../../shared/lib/dates'
import { useLocalDay } from '../../shared/lib/useLocalDay'
import { setOfflineState, useOfflineState } from '../../shared/offline/offline'
import { isEncryptionEnabled } from '../../shared/crypto/crypto'

import { useConfirm } from '../../shared/ui/confirm'
import { NotesIcon } from '../../shared/ui/EmptyStateIcons'
import { ErrorState, LoadingState } from '../../shared/ui/QueryState'
import { Spinner } from '../../shared/ui/Spinner'
import { useToast } from '../../shared/ui/toast'
import { mergeFeedPages, useDeleteEntry, useEntriesFeed } from './api'
import { DayGroup } from './DayGroup'
import { useEntryModalActions } from './EntryModalContext'
import type { EntryResult } from './types'
import { decryptEntries } from './entryCodec'
import { pendingAsRaw, pendingBelongsToCurrentUser, usePendingEntries } from './offlineEntries'

import './entries.css'

/** Лента записей, сгруппированных по дням, с подгрузкой при прокрутке. */
export function EntriesTab({ active = true }: { active?: boolean }) {
  const {
    data,
    error,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    refetch,
  } = useEntriesFeed(active)
  const deleteEntry = useDeleteEntry()
  const confirm = useConfirm()
  const showToast = useToast()
  const { open } = useEntryModalActions()
  const loaderRef = useRef<HTMLDivElement>(null)
  const queued = usePendingEntries()
  const [localEntries, setLocalEntries] = useState<EntryResult[]>([])
  const { connected } = useOfflineState()
  const today = useLocalDay()

  useEffect(() => {
    if (!data) return
    const entries = data.pages.flatMap((page) => page.days.flatMap((day) => day.entries))
    setOfflineState({
      writeBlocked:
        isEncryptionEnabled() &&
        entries.length > 0 &&
        entries.every((entry) => entry.kind === 'corrupted'),
    })
  }, [data])

  useEffect(() => {
    let cancelled = false
    if (!pendingBelongsToCurrentUser()) {
      setLocalEntries([])
      return
    }
    void decryptEntries(queued.map(pendingAsRaw))
      .then((entries) => {
        if (cancelled) return
        setLocalEntries(
          entries.map((entry, index) =>
            entry.kind === 'ready'
              ? {
                  ...entry,
                  syncStatus: queued[index]?.state === 'failed' ? 'failed' : 'pending',
                  syncError: queued[index]?.error ?? '',
                }
              : entry,
          ),
        )
      })
      .catch(() => {
        if (!cancelled) setLocalEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [queued])

  const days = useMemo(
    () =>
      mergeFeedPages([
        {
          days: localEntries.map((entry) => ({
            day: localDateKey(entry.timestamp),
            entries: [entry],
          })),
          nextBefore: null,
        },
        ...(data?.pages ?? []),
      ]),
    [data?.pages, localEntries],
  )

  // Лоадер попал в область видимости — просим следующую страницу.
  // Эффект пересоздаёт наблюдателя после каждой догрузки: если лоадер всё ещё
  // виден, колбэк срабатывает снова и лента догружается дальше.
  useEffect(() => {
    const loader = loaderRef.current
    if (!active || !connected || !loader || !hasNextPage || isFetchingNextPage || error) return

    const observer = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) void fetchNextPage()
    })
    observer.observe(loader)
    return () => observer.disconnect()
  }, [active, connected, hasNextPage, isFetchingNextPage, fetchNextPage, error])

  const requestDelete = useCallback(
    (entry: EntryResult) => {
      confirm({
        title: 'Удалить запись?',
        text: 'Это действие нельзя отменить.',
        onConfirm: async () => {
          await deleteEntry.mutateAsync(entry.id)
          showToast('Запись удалена')
        },
      })
    },
    [confirm, deleteEntry, showToast],
  )

  const isEmpty = !isLoading && days.length === 0
  // Лоадер скрыт, когда страниц больше нет — как в старом фронте.
  const loaderVisible = connected && (isLoading || hasNextPage)

  if (isLoading && days.length === 0) return <LoadingState label="Загружаем записи…" />
  if (error && !data && days.length === 0) {
    return <ErrorState message="Не удалось загрузить записи" onRetry={() => void refetch()} />
  }

  return (
    <>
      {isEmpty ? (
        <div className="empty-state">
          <div className="empty-icon">
            <NotesIcon />
          </div>
          <p className="empty-title">Пока пусто</p>
          <p className="empty-sub">Нажми «+» чтобы добавить первую запись</p>
        </div>
      ) : null}

      {days.length > 0 ? (
        <div className="feed">
          {days.map((group) => (
            <DayGroup
              key={group.day}
              group={group}
              today={today}
              onOpen={open}
              onDelete={requestDelete}
            />
          ))}
        </div>
      ) : null}

      {error && data ? (
        <ErrorState
          message={
            isFetchNextPageError
              ? 'Не удалось загрузить следующие записи'
              : 'Не удалось обновить записи'
          }
          onRetry={() => {
            if (isFetchNextPageError) void fetchNextPage()
            else void refetch()
          }}
        />
      ) : null}
      {!connected && hasNextPage && (
        <p className="feed-offline-hint">
          Показаны загруженные записи. Остальная история доступна при подключении.
        </p>
      )}
      <div
        className={loaderVisible && !error ? 'scroll-loader' : 'scroll-loader hidden'}
        ref={loaderRef}
      >
        <Spinner />
      </div>
    </>
  )
}

export default EntriesTab
