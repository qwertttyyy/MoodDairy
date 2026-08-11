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
import type {
  ChartRawEntry,
  DateRangeResponse,
  GroupedEntriesResponse,
  RawEntry,
  Tag,
} from '../../shared/api/types'
import { decrypt, encrypt } from '../../shared/crypto/crypto'
import type { ChartEntry } from '../chart/types'
import type { DecryptedEntry, EntryDayGroup, EntryFormData } from './types'

/** Относительные отрезки от текущего момента. */
export type ChartPeriod = '6months' | '2weeks'

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

export async function decryptEntry(raw: RawEntry): Promise<DecryptedEntry> {
  return {
    id: raw.id,
    mood: parseInt(await decrypt(raw.mood), 10) || 0,
    note: raw.note ? await decrypt(raw.note) : '',
    anxiety: raw.anxiety ? parseInt(await decrypt(raw.anxiety), 10) || 0 : 0,
    tags: raw.tags ?? [],
    timestamp: raw.timestamp,
  }
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
    queryFn: async ({ pageParam }) => {
      const before = pageParam as string | null
      const url = before
        ? `/api/entries/grouped/?before=${encodeURIComponent(before)}`
        : '/api/entries/grouped/'
      const data = await api.get<GroupedEntriesResponse>(url)

      const days = await Promise.all(
        Object.entries(data.results).map(async ([day, items]) => ({
          day,
          entries: await Promise.all(items.map(decryptEntry)),
        })),
      )
      return { days, nextBefore: data.next_before }
    },
    getNextPageParam: (lastPage) => lastPage.nextBefore,
  })
}

/** Склеивает страницы ленты в дни, отсортированные от новых к старым. */
export function mergeFeedPages(pages: FeedPage[] | undefined): EntryDayGroup[] {
  const byDay = new Map<string, DecryptedEntry[]>()
  for (const page of pages ?? []) {
    for (const group of page.days) {
      const existing = byDay.get(group.day)
      if (existing) existing.push(...group.entries)
      else byDay.set(group.day, [...group.entries])
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, entries]) => ({ day, entries }))
}

/** Данные графика: нужен только mood, поэтому заметки не расшифровываем. */
export function useChartEntries(query: ChartQuery, enabled: boolean) {
  return useQuery<ChartEntry[]>({
    queryKey: entriesKeys.chart(query),
    enabled,
    // При смене периода на канвасе остаётся прежняя картинка до перерисовки —
    // как в старом фронте, где график не исчезал на время запроса.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const raw = await api.get<ChartRawEntry[]>(buildChartUrl(query))
      const entries = await Promise.all(
        raw.map(async (item) => ({
          mood: parseInt(await decrypt(item.mood), 10) || 0,
          timestamp: item.timestamp,
        })),
      )
      return entries
        .filter((entry) => entry.mood >= 1 && entry.mood <= 9)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
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
    queryFn: () => api.get<DateRangeResponse>('/api/entries/date-range/'),
  })
}

export function useTags() {
  return useQuery<Tag[]>({
    queryKey: entriesKeys.tags,
    queryFn: () => api.get<Tag[]>('/api/tags/'),
  })
}

/**
 * Мутации тегов.
 *
 * Теги принадлежат пользователю, поэтому их можно заводить и удалять из
 * интерфейса. После любой правки сбрасываем и список тегов, и записи: теги
 * входят в ленту, а на сервере их изменение обнуляет кэш записей.
 */
function useTagMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<unknown>,
) {
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
  return useTagMutation((name: string) => api.post<Tag>('/api/tags/', { name }))
}

export function useRenameTag() {
  return useTagMutation(({ id, name }: { id: number; name: string }) =>
    api.patch<Tag>(`/api/tags/${id}/`, { name }),
  )
}

/** Удаление тега не трогает записи: пропадает только связь с ними. */
export function useDeleteTag() {
  return useTagMutation((id: number) => api.del<void>(`/api/tags/${id}/`))
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
        ? api.put<RawEntry>(`/api/entries/${editId}/`, body)
        : api.post<RawEntry>('/api/entries/', body)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: entriesKeys.all }),
  })
}

export function useDeleteEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/entries/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: entriesKeys.all }),
  })
}
