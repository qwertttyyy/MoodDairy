/**
 * Слой данных для блока «Доступ для врача» (`/api/sharing/`).
 *
 * Порт модуля `Share` из backend/static/app.js. Ключевой инвариант схемы:
 * снапшот записей перешифровывается ОДНОРАЗОВЫМ 256-битным ключом, на сервер уходит
 * только шифротекст `ivB64:ctB64` (AES-GCM, IV 12 байт), а сам ключ возвращается
 * вызывающему коду и попадает лишь в #-фрагмент ссылки. Фрагмент браузер не отправляет
 * в HTTP-запросах, поэтому сервер ключа не видит никогда.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, REQUEST_TIMEOUTS } from '../../shared/api/client'
import {
  cachedGet,
  currentOfflineUser,
  offlineSessionGeneration,
} from '../../shared/offline/offline'
import { isCurrentUser, userQueryKey } from '../../shared/offline/queryScope'
import { decryptScores } from '../entries/entryCodec'
import {
  createShareResponseSchema,
  sharingStatusResponseSchema,
  shareEntrySchema,
  snapshotRawEntriesSchema,
  voidResponseSchema,
} from '../../shared/api/types'
import type { ShareEntry, SharingStatusResponse } from '../../shared/api/types'
import {
  decrypt,
  encryptWithKey,
  generateShareKey,
  isEncryptionEnabled,
} from '../../shared/crypto/crypto'

export const sharingKeys = {
  status: ['sharing', 'status'] as const,
}

/** Результат создания ссылки. `shareKeyB64` пуст, когда шифрование выключено. */
export interface CreatedShare {
  token: string
  shareKeyB64: string
}

export class IncompleteShareError extends Error {
  constructor() {
    super('Ссылку нельзя создать: часть записей не удалось расшифровать')
    this.name = 'IncompleteShareError'
  }
}

/** Метаданные активной ссылки. Ошибку не показываем — как и старый `Share.loadActive`. */
export function useSharingStatus(enabled = true) {
  return useQuery<SharingStatusResponse>({
    networkMode: 'always',
    queryKey: userQueryKey(sharingKeys.status),
    enabled,
    queryFn: ({ signal }) => cachedGet('/api/sharing/', sharingStatusResponseSchema, { signal }),
  })
}

export function useCreateShare() {
  const ownerId = currentOfflineUser()?.id
  const version = offlineSessionGeneration()
  const queryClient = useQueryClient()
  return useMutation<CreatedShare, Error, void>({
    networkMode: 'always',
    mutationFn: () => createShare(ownerId, version),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sharingKeys.status }),
  })
}

export function useRevokeShare() {
  const ownerId = currentOfflineUser()?.id
  const version = offlineSessionGeneration()
  const queryClient = useQueryClient()
  return useMutation<void, Error, void>({
    networkMode: 'always',
    // Отзыв идемпотентен: сервер отвечает 204 и когда ссылка была,
    // и когда её не существовало.
    mutationFn: () => {
      assertCurrentSession(ownerId, version)
      return api.del('/api/sharing/', voidResponseSchema)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sharingKeys.status }),
  })
}

/** Собирает ссылку врачу: ключ уходит только во фрагмент. */
export function buildShareUrl(token: string, shareKeyB64: string): string {
  const url = `${location.origin}/share/${token}/`
  return shareKeyB64 ? `${url}#${shareKeyB64}` : url
}

/**
 * Выгружает все записи, расшифровывает ключом пользователя и публикует снапшот.
 * Возвращает токен и одноразовый ключ, который нужен только для сборки ссылки.
 */
function assertCurrentSession(ownerId: number | undefined, version: number): void {
  if (!isCurrentUser(ownerId, version))
    throw new Error('Аккаунт изменился. Откройте настройки заново.')
}

async function createShare(ownerId: number | undefined, version: number): Promise<CreatedShare> {
  assertCurrentSession(ownerId, version)
  const plainJson = await buildSnapshotJson()
  assertCurrentSession(ownerId, version)

  // Флаг is_encrypted серверу не передаём: режим шифрования — состояние
  // бэкенда, а не выбор клиента, иначе укравший сессию мог бы создать ссылку,
  // помеченную как незашифрованная.
  if (!isEncryptionEnabled()) {
    const { token } = await api.post(
      '/api/sharing/',
      { data_blob: plainJson },
      createShareResponseSchema,
      { timeoutMs: REQUEST_TIMEOUTS.createShare },
    )
    return { token, shareKeyB64: '' }
  }

  const shareKey = generateShareKey()
  const dataBlob = await encryptWithKey(shareKey.raw, plainJson)
  assertCurrentSession(ownerId, version)
  const { token } = await api.post(
    '/api/sharing/',
    { data_blob: dataBlob },
    createShareResponseSchema,
    { timeoutMs: REQUEST_TIMEOUTS.createShare },
  )
  // В запросе только шифротекст: `shareKey.b64` остаётся в памяти вкладки.
  return { token, shareKeyB64: shareKey.b64 }
}

/**
 * Снапшот всех записей в открытом виде — то, что будет зашифровано ключом ссылки.
 *
 * Берётся из `/api/entries/snapshot/`, а не из списка записей: список отдаёт
 * только поля для графика и требует период, тогда как врачу нужен дневник
 * целиком, вместе с заметками.
 */
export async function buildSnapshotJson(): Promise<string> {
  const raw = await api.get('/api/entries/snapshot/', snapshotRawEntriesSchema)
  const settled = await Promise.allSettled(
    raw.map(async (item) =>
      shareEntrySchema.parse({
        ...(await decryptScores(item)),
        note: item.note ? await decrypt(item.note) : '',
        timestamp: item.timestamp,
      }),
    ),
  )
  if (settled.some((result) => result.status === 'rejected')) throw new IncompleteShareError()
  const entries: ShareEntry[] = settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  )
  return JSON.stringify(entries)
}
