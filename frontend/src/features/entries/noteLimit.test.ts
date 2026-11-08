import { afterEach, describe, expect, it } from 'vitest'
import {
  clearKeys,
  encrypt,
  setEncryptionEnabled,
  storeFromDerived,
} from '../../shared/crypto/crypto'
import { noteUsage } from './noteLimit'

afterEach(() => {
  clearKeys()
  setEncryptionEnabled(true)
})

describe('размер заметки на сервере', () => {
  it('считает UTF-8 и AES-GCM envelope для кириллицы и emoji', async () => {
    setEncryptionEnabled(true)
    storeFromDerived(new Uint8Array(32).fill(2).buffer)
    const note = 'Я🙂'.repeat(1000)
    const wire = await encrypt(note)
    expect(noteUsage(note)).toBe(wire.length / 8192)
    expect(noteUsage(note)).toBeLessThanOrEqual(1)
    expect(noteUsage(note + '🙂'.repeat(100))).toBeGreaterThan(1)
  })
})
