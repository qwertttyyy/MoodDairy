import { afterEach, describe, expect, it } from 'vitest'

import type { RawEntry } from '../../shared/api/types'
import { setEncryptionEnabled } from '../../shared/crypto/crypto'
import { decryptEntries } from './api'

afterEach(() => setEncryptionEnabled(true))

describe('частично повреждённый набор записей', () => {
  it('не скрывает корректные записи из-за одной повреждённой', async () => {
    setEncryptionEnabled(false)
    const base = { note: 'Текст', anxiety: '2', tags: [], timestamp: '2026-08-24T20:00:00Z' }
    const raw: RawEntry[] = [
      { ...base, id: 1, mood: '7' },
      { ...base, id: 2, mood: 'не число', note: 'Скрытый текст' },
    ]

    const entries = await decryptEntries(raw)

    expect(entries[0]).toMatchObject({ kind: 'ready', id: 1, mood: 7, note: 'Текст' })
    expect(entries[1]).toEqual({ kind: 'corrupted', id: 2, timestamp: base.timestamp })
    expect(JSON.stringify(entries[1])).not.toContain('Скрытый текст')
  })
})
