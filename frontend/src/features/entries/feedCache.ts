import { groupedEntriesResponseSchema } from '../../shared/api/types'
import type { RawEntry } from '../../shared/api/types'
import {
  currentOfflineUser,
  keysForUser,
  readForUser,
  storeForUser,
} from '../../shared/offline/offline'
import { readSealed } from '../../shared/offline/storage'
import { localDateKey } from '../../shared/lib/dates'

/** Patch persisted pages too, so a confirmed create/edit survives a later offline launch. */
export async function patchCachedFeed(entry: RawEntry | number): Promise<void> {
  const userId = currentOfflineUser()?.id
  const id = typeof entry === 'number' ? entry : entry.id
  const initialUrl = '/api/entries/grouped/'
  const initial = await readForUser<unknown>(`cache:${initialUrl}`)
  if (currentOfflineUser()?.id !== userId) return
  if (initial === undefined && typeof entry !== 'number') {
    await storeForUser(`cache:${initialUrl}`, {
      results: { [localDateKey(entry.timestamp)]: [entry] },
      next_before: localDateKey(new Date(Date.parse(entry.timestamp) + 2 * 86400000)),
    })
  }
  for (const key of await keysForUser(`cache:${initialUrl}`)) {
    if (currentOfflineUser()?.id !== userId) return
    const data = groupedEntriesResponseSchema.safeParse(await readSealed(key))
    if (currentOfflineUser()?.id !== userId) return
    if (!data.success) continue
    const results = Object.fromEntries(
      Object.entries(data.data.results)
        .map(([day, entries]) => [day, entries.filter((item) => item.id !== id)] as const)
        .filter(([, entries]) => entries.length > 0),
    ) as Record<string, RawEntry[]>
    const suffix = key.slice(key.indexOf('cache:'))
    if (typeof entry !== 'number' && suffix === `cache:${initialUrl}`) {
      const day = localDateKey(entry.timestamp)
      results[day] = [...(results[day] ?? []), entry]
    }
    await storeForUser(suffix, { ...data.data, results })
  }
}
