/**
 * Слой данных для записей: запросы, расшифровка, мутации.
 * Инвалидация по префиксу `['entries']` разом сбрасывает ленту, график и границы дат.
 */

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { api } from '../../shared/api/client'
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
  DecryptionError,
  EncryptedDataFormatError,
  decrypt,
  encrypt,
} from '../../shared/crypto/crypto'
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

export async function decryptEntry(raw: RawEntry): Promise<EntryResult> {
  try {
    const mood = Number.parseInt(await decrypt(raw.mood), 10)
    const anxiety = raw.anxiety ? Number.parseInt(await decrypt(raw.anxiety), 10) : 0
    if (!Number.isInteger(mood) || mood < 1 || mood > 9) throw new EncryptedDataFormatError()
    if (!Number.isInteger(anxiety) || anxiety < 0 || anxiety > 5) {
      throw new EncryptedDataFormatError()
    }
    return {
      kind: 'ready',
      id: raw.id,
      mood,
      note: raw.note ? await decrypt(raw.note) : '',
      anxiety,
      tags: raw.tags,
      timestamp: raw.timestamp,
    }
  } catch (error) {
    if (error instanceof EncryptedDataFormatError || error instanceof DecryptionError) {
      return { kind: 'corrupted', id: raw.id, timestamp: raw.timestamp }
    }
    throw error
  }
}

export async function decryptEntries(items: RawEntry[]): Promise<EntryResult[]> {
  const settled = await Promise.allSettled(items.map(decryptEntry))
  return settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value
    const raw = items[index]
    if (!raw) throw new Error('Результат расшифровки не соответствует записи')
    return { kind: 'corrupted', id: raw.id, timestamp: raw.timestamp }
  })
}

interface FeedPage {
  days: EntryDayGroup[]
  nextBefore: string | null
}

/** Лента записей: постраничная выборка по курсору `next_before`. */
export function useEntriesFeed() {
  return useInfiniteQuery<FeedPage>({
    queryKey: entriesKeys.feed,
    initialPageParam: null,
    queryFn: async ({ pageParam, signal }) => {
      const before = pageParam as string | null
      const url = before
        ? `/api/entries/grouped/?before=${encodeURIComponent(before)}`
        : '/api/entries/grouped/'
      const data = await api.get(url, groupedEntriesResponseSchema, { signal })

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
  for (const page of pages ?? []) {
    for (const group of page.days) {
      for (const entry of group.entries) {
        const day = localDateKey(entry.timestamp)
        const existing = byDay.get(day)
        if (existing) existing.push(entry)
        else byDay.set(day, [entry])
      }
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, entries]) => ({ day, entries }))
}

/** Данные графиков: нужны mood и anxiety, поэтому заметки не расшифровываем. */
export interface ChartData {
  entries: ChartEntry[]
  corruptedCount: number
}

export function useChartEntries(query: ChartQuery, enabled: boolean) {
  return useQuery<ChartData>({
    queryKey: entriesKeys.chart(query),
    enabled,
    // При смене периода на канвасе остаётся прежняя картинка до перерисовки —
    // как в старом фронте, где график не исчезал на время запроса.
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const raw = await api.get(buildChartUrl(query), chartRawEntriesSchema, { signal })
      const settled = await Promise.allSettled(
        raw.map(async (item) => {
          const mood = Number.parseInt(await decrypt(item.mood), 10)
          const anxiety = item.anxiety ? Number.parseInt(await decrypt(item.anxiety), 10) : 0
          if (
            !Number.isInteger(mood) ||
            mood < 1 ||
            mood > 9 ||
            !Number.isInteger(anxiety) ||
            anxiety < 0 ||
            anxiety > 5
          ) {
            throw new EncryptedDataFormatError()
          }
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
    queryKey: entriesKeys.dateRange,
    enabled,
    queryFn: ({ signal }) =>
      api.get('/api/entries/date-range/', dateRangeResponseSchema, { signal }),
  })
}

export function useTags() {
  return useQuery<Tag[]>({
    queryKey: entriesKeys.tags,
    queryFn: ({ signal }) => api.get('/api/tags/', tagsSchema, { signal }),
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
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
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
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ data, editId }: { data: EntryFormData; editId: number | null }) => {
      const body = {
        mood: await encrypt(String(data.mood)),
        note: data.note ? await encrypt(data.note) : '',
        anxiety: data.anxiety ? await encrypt(String(data.anxiety)) : '',
        tags: data.tags,
        timestamp: data.timestamp,
      }
      return editId
        ? api.put(`/api/entries/${editId}/`, body, rawEntrySchema)
        : api.post('/api/entries/', body, rawEntrySchema)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: entriesKeys.all }),
  })
}

export function useDeleteEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/entries/${id}/`, voidResponseSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: entriesKeys.all }),
  })
}
