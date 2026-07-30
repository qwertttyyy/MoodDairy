/**
 * Загрузка снапшота дневника для страницы врача.
 *
 * Единственный запрос страницы — `GET /api/sharing/{token}/data/`: страница работает
 * без авторизации и не обращается ни к `/api/config/`, ни к `/api/auth/*`.
 * Ключ живёт только во фрагменте URL (`#...`): браузер фрагмент на сервер не отправляет,
 * и мы его тоже никуда не передаём — только в расшифровку.
 */

import { api } from '../../shared/api/client'
import type { ShareDataResponse, ShareEntry } from '../../shared/api/types'
import { decryptWithKey } from '../../shared/crypto/crypto'
import { b64ToBytes } from '../../shared/lib/base64'

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
export async function loadShareEntries(token: string, shareKeyB64: string): Promise<ShareEntry[]> {
  const data = await api.get<ShareDataResponse>(`/api/sharing/${encodeURIComponent(token)}/data/`)

  let json: string
  if (data.is_encrypted) {
    if (!shareKeyB64) throw new MissingKeyError()
    json = await decryptWithKey(b64ToBytes(shareKeyB64), data.data_blob)
  } else {
    json = data.data_blob
  }

  const entries = JSON.parse(json) as ShareEntry[]
  return entries.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}
