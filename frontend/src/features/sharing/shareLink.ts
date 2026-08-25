import { buildShareUrl } from './api'
import type { CreatedShare } from './api'

export const HIDDEN_LINK_TEXT = 'Полная ссылка недоступна после перезагрузки'

/** Полный URL доступен только пока ключ зашифрованной ссылки остаётся в памяти. */
export function resolveShareUrl(
  created: CreatedShare | null,
  serverShare: { token: string; is_encrypted: boolean } | null,
): string | null {
  if (created) return buildShareUrl(created.token, created.shareKeyB64)
  if (serverShare && !serverShare.is_encrypted) return buildShareUrl(serverShare.token, '')
  return null
}
