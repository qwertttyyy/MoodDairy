/**
 * Слой данных для записей: запросы, расшифровка, мутации.
 * Инвалидация по префиксу `['entries']` разом сбрасывает ленту, график и границы дат.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { api } from '../../shared/api/client'
import { isCurrentUser, userQueryKey } from '../../shared/offline/queryScope'
import {
  chartRawEntriesSchema,
  dateRangeResponseSchema,
  groupedEntriesResponseSchema,
  rawEntrySchema,
  tagSchema,
  tagsSchema,
  voidResponseSchema,
} from '../../shared/api/types'
import type { DateRangeResponse, RawEntry, Tag } from '../../shared/api/types'
import {
  cachedGet,
  currentOfflineUser,
  offlineSessionGeneration,
  diaryWritesBlocked,
  setOfflineState,
} from '../../shared/offline/offline'
import { decryptEntries, decryptEntry, decryptScores, encryptEntry } from './entryCodec'
import { editPendingEntry, OfflineStorageError, queueEntry } from './offlineEntries'
import { patchCachedFeed } from './feedCache'
export { decryptEntry, decryptEntries } from './entryCodec'
import { localDateKey } from '../../shared/lib/dates'
import type { ChartEntry } from '../chart/types'
import type { EntryDayGroup, EntryFormData, EntryResult } from './types'

/**
 * Относительные отрезки от текущего момента (список из PERIOD_DAYS бэкенда).
 * `month` и `year` нужны экрану графика для тренда: предыдущие две недели и
 * предыдущие полгода отдельным запросом не получить, они вырезаются из
 * ближайшего периода подлиннее.
 */
export type ChartPeriod = '2weeks' | 'month' | '6months' | 'year'

/**
 * Что показываем на графике.
 *
 * Режима «всё время» больше нет: бэкенд требует период, чтобы одним запросом
 * нельзя было вытянуть всю историю. Вместо него — переключение по календарным
 * годам, как по месяцам.
 */
export type ChartQuery =
  | { kind: 'period'; period: ChartPeriod }
  | { kind: 'year'; year: number }
  | { kind: 'month'; year: number; month: number }

export const entriesKeys = {
  all: ['entries'] as const,
  feed: ['entries', 'feed'] as const,
  chart: (query: ChartQuery) => ['entries', 'chart', query] as const,
  dateRange: ['entries', 'date-range'] as const,
  tags: ['tags'] as const,
}

export interface FeedPage {
  days: EntryDayGroup[]
  nextBefore: string | null
}

/** Лента записей: постраничная выборка по курсору `next_before`. */
export function useEntriesFeed(enabled = true) {
  return useInfiniteQuery<FeedPage>({
    networkMode: 'always',
    queryKey: userQueryKey(entriesKeys.feed),
    enabled,
    initialPageParam: null,
    queryFn: async ({ pageParam, signal }) => {
      const before = pageParam as string | null
      const url = before
        ? `/api/entries/grouped/?before=${encodeURIComponent(before)}`
        : '/api/entries/grouped/'
      const data = await cachedGet(url, groupedEntriesResponseSchema, { signal })

      const days = await Promise.all(
        Object.entries(data.results).map(async ([day, items]) => ({
          day,
          entries: await decryptEntries(items),
        })),
      )
      return { days, nextBefore: data.next_before }
    },
    getNextPageParam: (lastPage) => lastPage.nextBefore,
  })
}

/** Склеивает страницы ленты в дни, отсортированные от новых к старым. */
export function mergeFeedPages(pages: FeedPage[] | undefined): EntryDayGroup[] {
  const byDay = new Map<string, EntryResult[]>()
  const seen = new Set<number>()
  for (const page of pages ?? []) {
    for (const group of page.days) {
      for (const entry of group.entries) {
        if (seen.has(entry.id)) continue
        seen.add(entry.id)
        const day = localDateKey(entry.timestamp)
        const existing = byDay.get(day)
        if (existing) existing.push(entry)
        else byDay.set(day, [entry])
      }
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, entries]) => ({
      day,
      entries: entries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)),
    }))
}

/** Данные графиков: нужны mood и anxiety, поэтому заметки не расшифровываем. */
export interface ChartData {
  entries: ChartEntry[]
  corruptedCount: number
}

export function useChartEntries(query: ChartQuery, enabled: boolean) {
  return useQuery<ChartData>({
    networkMode: 'always',
    queryKey: userQueryKey(entriesKeys.chart(query)),
    enabled,
    queryFn: async ({ signal }) => {
      const raw = await cachedGet(buildChartUrl(query), chartRawEntriesSchema, { signal })
      const settled = await Promise.allSettled(
        raw.map(async (item) => {
          const { mood, anxiety } = await decryptScores(item)
          return { mood, anxiety, timestamp: item.timestamp }
        }),
      )
      const entries = settled
        .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
        .filter((entry) => entry.mood >= 1 && entry.mood <= 9)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      return { entries, corruptedCount: settled.length - entries.length }
    },
  })
}

/** Период обязателен: без него бэкенд отвечает 400. */
export function buildChartUrl(query: ChartQuery): string {
  switch (query.kind) {
    case 'month':
      return `/api/entries/?year=${query.year}&month=${query.month}`
    case 'year':
      return `/api/entries/?year=${query.year}`
    default:
      return `/api/entries/?period=${query.period}`
  }
}

/** Дата первой записи — нижняя граница помесячной навигации. */
export function useDateRange(enabled: boolean) {
  return useQuery<DateRangeResponse>({
    networkMode: 'always',
    queryKey: userQueryKey(entriesKeys.dateRange),
    enabled,
    queryFn: ({ signal }) =>
      cachedGet('/api/entries/date-range/', dateRangeResponseSchema, { signal }),
  })
}

export function useTags(enabled = true) {
  return useQuery<Tag[]>({
    networkMode: 'always',
    queryKey: userQueryKey(entriesKeys.tags),
    enabled,
    queryFn: ({ signal }) => cachedGet('/api/tags/', tagsSchema, { signal }),
  })
}

/**
 * Мутации тегов.
 *
 * Теги принадлежат пользователю, поэтому их можно заводить и удалять из
 * интерфейса. После любой правки сбрасываем и список тегов, и записи: теги
 * входят в ленту, а на сервере их изменение обнуляет кэш записей.
 */
function useTagMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<unknown>) {
  const ownerId = currentOfflineUser()?.id
  const version = offlineSessionGeneration()
  const queryClient = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: (variables: TVariables) => {
      if (!isCurrentUser(ownerId, version))
        throw new Error('Аккаунт изменился. Откройте настройки заново.')
      return mutationFn(variables)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: entriesKeys.tags })
      void queryClient.invalidateQueries({ queryKey: entriesKeys.all })
    },
  })
}

export function useCreateTag() {
  return useTagMutation((name: string) => api.post('/api/tags/', { name }, tagSchema))
}

export function useRenameTag() {
  return useTagMutation(({ id, name }: { id: number; name: string }) =>
    api.patch(`/api/tags/${id}/`, { name }, tagSchema),
  )
}

/** Удаление тега не трогает записи: пропадает только связь с ними. */
export function useDeleteTag() {
  return useTagMutation((id: number) => api.del(`/api/tags/${id}/`, voidResponseSchema))
}

export function useSaveEntry() {
  const ownerId = currentOfflineUser()?.id
  const sessionGeneration = offlineSessionGeneration()
  const queryClient = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ data, editId }: { data: EntryFormData; editId: number | null }) => {
      if (!isCurrentUser(ownerId, sessionGeneration))
        throw new Error('Аккаунт изменился. Откройте запись заново.')
      if (diaryWritesBlocked())
        throw new Error('Сначала разблокируйте дневник: войдите заново с паролем.')
      const body = await encryptEntry(data)
      if (!isCurrentUser(ownerId, sessionGeneration))
        throw new Error('Аккаунт изменился. Запись не отправлена.')
      if (editId !== null && editId < 0) {
        const tags = queryClient.getQueryData<Tag[]>(userQueryKey(entriesKeys.tags, ownerId)) ?? []
        const result = await editPendingEntry(
          editId,
          body,
          tags.filter((tag) => data.tags.includes(tag.id)),
        )
        if (!result) throw new Error('Не удалось обновить локальную запись')
        return result
      }
      if (editId === null && currentOfflineUser()) {
        const tags = queryClient.getQueryData<Tag[]>(userQueryKey(entriesKeys.tags, ownerId)) ?? []
        try {
          return await queueEntry(
            body,
            tags.filter((tag) => data.tags.includes(tag.id)),
          )
        } catch (error) {
          if (
            !(error instanceof OfflineStorageError) ||
            !navigator.onLine ||
            !isCurrentUser(ownerId, sessionGeneration)
          )
            throw error
          return api.post('/api/entries/', body, rawEntrySchema)
        }
      }
      if (!navigator.onLine) throw new Error('Для изменения записи подключитесь к интернету')
      return editId
        ? api.put(`/api/entries/${editId}/`, body, rawEntrySchema)
        : api.post('/api/entries/', body, rawEntrySchema)
    },
    onSuccess: async (raw) => {
      if (raw.id < 0 || !isCurrentUser(ownerId, sessionGeneration)) return
      await queryClient.cancelQueries({ queryKey: entriesKeys.feed })
      await applySavedEntry(queryClient, raw, ownerId)
      await patchCachedFeed(raw).catch(() => setOfflineState({ storageError: true }))
    },
  })
}

export function useDeleteEntry() {
  const ownerId = currentOfflineUser()?.id
  const sessionGeneration = offlineSessionGeneration()
  const queryClient = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: (id: number) => {
      if (!isCurrentUser(ownerId, sessionGeneration))
        throw new Error('Аккаунт изменился. Откройте запись заново.')
      if (id < 0) return editPendingEntry(id).then(() => undefined)
      if (!navigator.onLine) throw new Error('Для удаления подключитесь к интернету')
      return api.del(`/api/entries/${id}/`, voidResponseSchema)
    },
    onSuccess: async (_data, id) => {
      if (id < 0 || !isCurrentUser(ownerId, sessionGeneration)) return
      await queryClient.cancelQueries({ queryKey: entriesKeys.feed })
      await patchCachedFeed(id).catch(() => setOfflineState({ storageError: true }))
      queryClient.setQueryData<InfiniteData<FeedPage>>(
        userQueryKey(entriesKeys.feed, ownerId),
        (current) =>
          current
            ? {
                ...current,
                pages: current.pages.map((page) => ({
                  ...page,
                  days: page.days
                    .map((day) => ({
                      ...day,
                      entries: day.entries.filter((entry) => entry.id !== id),
                    }))
                    .filter((day) => day.entries.length > 0),
                })),
              }
            : current,
      )
      void queryClient.invalidateQueries({ queryKey: entriesKeys.all, refetchType: 'none' })
      void queryClient.invalidateQueries({ queryKey: ['entries', 'chart'] })
      void queryClient.invalidateQueries({ queryKey: entriesKeys.dateRange })
    },
  })
}

/** Apply the confirmed result without waiting for every loaded page to refetch. */
export async function applySavedEntry(
  queryClient: QueryClient,
  raw: RawEntry,
  ownerId = currentOfflineUser()?.id,
): Promise<void> {
  const sessionGeneration = offlineSessionGeneration()
  if (!isCurrentUser(ownerId, sessionGeneration)) return
  const entry = await decryptEntry(raw)
  if (!isCurrentUser(ownerId, sessionGeneration)) return
  queryClient.setQueryData<InfiniteData<FeedPage>>(
    userQueryKey(entriesKeys.feed, ownerId),
    (current) => {
      if (!current?.pages.length)
        return {
          pages: [
            {
              days: [{ day: localDateKey(entry.timestamp), entries: [entry] }],
              nextBefore: localDateKey(new Date(Date.parse(entry.timestamp) + 2 * 86400000)),
            },
          ],
          pageParams: [null],
        }
      const pages = current.pages.map((page) => ({
        ...page,
        days: page.days
          .map((day) => ({ ...day, entries: day.entries.filter((item) => item.id !== entry.id) }))
          .filter((day) => day.entries.length > 0),
      }))
      const first = pages[0]
      if (first) {
        const key = localDateKey(entry.timestamp)
        const day = first.days.find((item) => item.day === key)
        if (day) day.entries.push(entry)
        else first.days.push({ day: key, entries: [entry] })
      }
      return { ...current, pages }
    },
  )
  void queryClient.invalidateQueries({ queryKey: entriesKeys.all, refetchType: 'none' })
  void queryClient.invalidateQueries({ queryKey: ['entries', 'chart'] })
  void queryClient.invalidateQueries({ queryKey: entriesKeys.dateRange })
}
