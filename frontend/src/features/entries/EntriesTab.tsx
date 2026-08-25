import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useConfirm } from '../../shared/ui/confirm'
import { NotesIcon } from '../../shared/ui/EmptyStateIcons'
import { ErrorState, LoadingState } from '../../shared/ui/QueryState'
import { Spinner } from '../../shared/ui/Spinner'
import { useToast } from '../../shared/ui/toast'
import { mergeFeedPages, useDeleteEntry, useEntriesFeed } from './api'
import { DayGroup } from './DayGroup'
import { useEntryModal } from './EntryModalContext'
import type { EntryResult } from './types'

import './entries.css'

/** Лента записей, сгруппированных по дням, с подгрузкой при прокрутке. */
export function EntriesTab({ active = true }: { active?: boolean }) {
  const { data, error, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useEntriesFeed(active)
  const deleteEntry = useDeleteEntry()
  const confirm = useConfirm()
  const showToast = useToast()
  const { open } = useEntryModal()
  const loaderRef = useRef<HTMLDivElement>(null)

  const days = useMemo(() => mergeFeedPages(data?.pages), [data?.pages])

  // Лоадер попал в область видимости — просим следующую страницу.
  // Эффект пересоздаёт наблюдателя после каждой догрузки: если лоадер всё ещё
  // виден, колбэк срабатывает снова и лента догружается дальше.
  useEffect(() => {
    const loader = loaderRef.current
    if (!loader || !hasNextPage || isFetchingNextPage) return

    const observer = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) void fetchNextPage()
    })
    observer.observe(loader)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

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
  const loaderVisible = isLoading || hasNextPage

  if (isLoading) return <LoadingState label="Загружаем записи…" />
  if (error) {
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
            <DayGroup key={group.day} group={group} onOpen={open} onDelete={requestDelete} />
          ))}
        </div>
      ) : null}

      <div className={loaderVisible ? 'scroll-loader' : 'scroll-loader hidden'} ref={loaderRef}>
        <Spinner />
      </div>
    </>
  )
}

export default EntriesTab
