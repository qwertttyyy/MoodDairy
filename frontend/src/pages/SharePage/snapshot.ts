/**
 * Загрузка снапшота дневника для страницы врача.
 *
 * Единственный запрос страницы — `GET /api/sharing/{token}/data/`: страница работает
 * без авторизации и не обращается ни к `/api/config/`, ни к `/api/auth/*`.
 * Ключ живёт только во фрагменте URL (`#...`): браузер фрагмент на сервер не отправляет,
 * и мы его тоже никуда не передаём — только в расшифровку.
 */

import { api, IncompatibleApiResponseError } from '../../shared/api/client'
import { shareDataResponseSchema, shareEntriesSchema } from '../../shared/api/types'
import type { ShareEntry } from '../../shared/api/types'
import { decodeEncryptionKey, decryptWithKey } from '../../shared/crypto/crypto'

/** Снапшот зашифрован, а ключа во фрагменте нет: врачу нужна ссылка целиком. */
export class MissingKeyError extends Error {
  constructor() {
    super('missing share key')
    this.name = 'MissingKeyError'
  }
}

/** Ключ доступа из фрагмента URL: первый символ `#` отбрасывается. */
export function readShareKeyFromHash(): string {
  return window.location.hash ? window.location.hash.slice(1) : ''
}

/** Записи снапшота, отсортированные по времени по возрастанию. */
export async function loadShareEntries(
  token: string,
  shareKeyB64: string,
  signal?: AbortSignal,
): Promise<ShareEntry[]> {
  const data = await api.get(
    `/api/sharing/${encodeURIComponent(token)}/data/`,
    shareDataResponseSchema,
    signal ? { signal } : {},
  )

  let json: string
  if (data.is_encrypted) {
    if (!shareKeyB64) throw new MissingKeyError()
    json = await decryptWithKey(decodeEncryptionKey(shareKeyB64), data.data_blob)
  } else {
    json = data.data_blob
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(json)
  } catch {
    throw new IncompatibleApiResponseError([{ path: [], message: 'Некорректный JSON снапшота' }])
  }
  const result = shareEntriesSchema.safeParse(decoded)
  if (!result.success) {
    throw new IncompatibleApiResponseError(
      result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    )
  }
  const entries = result.data
  return entries.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}
