import { currentOfflineUser, offlineSessionGeneration } from './offline'

/** Keep private query results separate even when an old mutation finishes late. */
export function userQueryKey(
  key: readonly unknown[],
  userId = currentOfflineUser()?.id,
): readonly unknown[] {
  return [...key, { userId: userId ?? null }]
}

export function isCurrentUser(userId: number | undefined, generation?: number): boolean {
  return (
    currentOfflineUser()?.id === userId &&
    (generation === undefined || generation === offlineSessionGeneration())
  )
}
