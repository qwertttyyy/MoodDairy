import type { RawEntry } from '../../shared/api/types'
import {
  DecryptionError,
  EncryptedDataFormatError,
  decrypt,
  encrypt,
} from '../../shared/crypto/crypto'
import type { EntryBody } from './offlineEntries'
import type { EntryFormData, EntryResult } from './types'

function score(text: string, min: number, max: number): number {
  if (!/^\d+$/.test(text)) throw new EncryptedDataFormatError()
  const number = Number(text)
  if (!Number.isInteger(number) || number < min || number > max)
    throw new EncryptedDataFormatError()
  return number
}

export async function decryptScores(item: { mood: string; anxiety: string }) {
  const [mood, anxiety] = await Promise.all([
    decrypt(item.mood),
    item.anxiety ? decrypt(item.anxiety) : Promise.resolve('0'),
  ])
  return { mood: score(mood, 1, 9), anxiety: score(anxiety, 0, 5) }
}

export async function decryptEntry(raw: RawEntry): Promise<EntryResult> {
  try {
    const [scores, note] = await Promise.all([
      decryptScores(raw),
      raw.note ? decrypt(raw.note) : Promise.resolve(''),
    ])
    return { kind: 'ready', id: raw.id, ...scores, note, tags: raw.tags, timestamp: raw.timestamp }
  } catch (error) {
    if (error instanceof EncryptedDataFormatError || error instanceof DecryptionError) {
      return { kind: 'corrupted', id: raw.id, timestamp: raw.timestamp }
    }
    throw error
  }
}

export function decryptEntries(items: RawEntry[]): Promise<EntryResult[]> {
  return Promise.all(items.map(decryptEntry))
}

export async function encryptEntry(data: EntryFormData): Promise<EntryBody> {
  const [mood, note, anxiety] = await Promise.all([
    encrypt(String(data.mood)),
    data.note ? encrypt(data.note) : Promise.resolve(''),
    data.anxiety ? encrypt(String(data.anxiety)) : Promise.resolve(''),
  ])
  return { mood, note, anxiety, tags: data.tags, timestamp: data.timestamp }
}
