import { describe, expect, it } from 'vitest'

import { resolveShareUrl } from './shareLink'

describe('ссылка общего доступа в памяти', () => {
  it('не восстанавливает зашифрованный URL без ключа и тем самым запрещает копирование', () => {
    expect(resolveShareUrl(null, { token: 'old', is_encrypted: true })).toBeNull()
  })

  it('восстанавливает незашифрованный URL, которому ключ не нужен', () => {
    expect(resolveShareUrl(null, { token: 'plain', is_encrypted: false })).toContain(
      '/share/plain/',
    )
  })

  it('добавляет ключ новой ссылки только в hash', () => {
    const url = resolveShareUrl({ token: 'new', shareKeyB64: 'secret-key' }, null)
    expect(url).toContain('/share/new/#secret-key')
    expect(new URL(url ?? location.href).search).toBe('')
  })
})
