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
  DateRangeResponse,
  GroupedEntriesResponse,
  RawEntry,
  Tag,
} from '../../shared/api/types'
import { decrypt, encrypt } from '../../shared/crypto/crypto'
import type { ChartEntry } from '../chart/types'
import type { DecryptedEntry, EntryDayGroup, EntryFormData } from './types'

export type ChartPeriod = 'all' | 'year' | '6months' | 'month' | '2weeks'

/** Что показываем на графике: период целиком или конкретный месяц. */
export type ChartQuery =
  | { kind: 'period'; period: ChartPeriod }
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
      const raw = await api.get<RawEntry[]>(buildChartUrl(query))
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

function buildChartUrl(query: ChartQuery): string {
  if (query.kind === 'month') return `/api/entries/?year=${query.year}&month=${query.month}`
  return query.period === 'all' ? '/api/entries/' : `/api/entries/?period=${query.period}`
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
