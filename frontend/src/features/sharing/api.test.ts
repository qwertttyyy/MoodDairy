import { afterEach, describe, expect, it, vi } from 'vitest'

import { setEncryptionEnabled } from '../../shared/crypto/crypto'
import { buildSnapshotJson, IncompleteShareError } from './api'

const timestamp = '2026-08-24T20:00:00Z'

afterEach(() => {
  setEncryptionEnabled(true)
  vi.unstubAllGlobals()
})

describe('публичный снапшот', () => {
  it('не создаёт неполную копию при повреждённой записи', async () => {
    setEncryptionEnabled(false)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify([
            { mood: '7', note: 'Корректная', anxiety: '2', timestamp },
            { mood: 'повреждено', note: 'Не должна уйти частично', anxiety: '', timestamp },
          ]),
        ),
      ),
    )

    await expect(buildSnapshotJson()).rejects.toBeInstanceOf(IncompleteShareError)
  })

  it('сериализует только полностью проверенный набор', async () => {
    setEncryptionEnabled(false)
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify([{ mood: '7', note: 'Корректная', anxiety: '', timestamp }])),
        ),
    )

    await expect(buildSnapshotJson()).resolves.toBe(
      JSON.stringify([{ mood: 7, note: 'Корректная', anxiety: 0, timestamp }]),
    )
  })
})
