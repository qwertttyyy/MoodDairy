import { afterEach, describe, expect, it } from 'vitest'

import type { RawEntry } from '../../shared/api/types'
import { setEncryptionEnabled } from '../../shared/crypto/crypto'
import { decryptEntries, mergeFeedPages } from './api'
import type { DecryptedEntry } from './types'

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

  it('не принимает число с посторонним суффиксом как корректную оценку', async () => {
    setEncryptionEnabled(false)
    const entries = await decryptEntries([
      { id: 1, mood: '7oops', anxiety: '', note: '', tags: [], timestamp: '2026-08-24T20:00:00Z' },
    ])
    expect(entries[0]?.kind).toBe('corrupted')
  })
})

describe('стабильность ленты после подтверждения записи', () => {
  const entry: DecryptedEntry = {
    kind: 'ready',
    id: 1,
    mood: 7,
    anxiety: 2,
    note: '',
    tags: [],
    timestamp: '2026-08-24T20:00:00Z',
  }
  const page = (entries: DecryptedEntry[]) => ({
    days: [{ day: '2026-08-24', entries }],
    nextBefore: null,
  })

  it('при одинаковом времени оставляет новые записи выше старых независимо от порядка ответа', () => {
    const [day] = mergeFeedPages([page([entry, { ...entry, id: 2 }])])
    expect(day?.entries.map((item) => item.id)).toEqual([2, 1])
  })

  it('показывает одну карточку при перекрытии очереди, подтверждения и страниц истории', () => {
    const [day] = mergeFeedPages([
      page([{ ...entry, id: 2, localId: -100 }]),
      page([{ ...entry, id: -100 }]),
      page([{ ...entry, id: 2 }]),
    ])
    expect(day?.entries.map((item) => item.id)).toEqual([2])
  })

  it('сохраняет порядок нескольких локальных записей при последовательном подтверждении', () => {
    const queued = { ...entry, id: -200 }
    const [before] = mergeFeedPages([page([entry, { ...entry, id: -100 }, queued])])
    const [during] = mergeFeedPages([
      page([entry, { ...entry, id: 2, localId: -100 }]),
      page([queued]),
    ])
    const [after] = mergeFeedPages([page([entry, { ...entry, id: 2 }, { ...entry, id: 3 }])])
    expect(before?.entries.map((item) => item.id)).toEqual([-200, -100, 1])
    expect(during?.entries.map((item) => item.id)).toEqual([-200, 2, 1])
    expect(after?.entries.map((item) => item.id)).toEqual([3, 2, 1])
  })
})
