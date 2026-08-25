import { describe, expect, it } from 'vitest'

import {
  appConfigSchema,
  authResponseSchema,
  groupedEntriesResponseSchema,
  rawEntrySchema,
  shareDataResponseSchema,
  shareEntriesSchema,
  sharingStatusResponseSchema,
} from './types'

const timestamp = '2026-08-24T20:30:00+00:00'
const rawEntry = {
  id: 7,
  mood: 'iv:mood',
  note: '',
  anxiety: '',
  tags: [{ id: 1, name: 'Работа' }],
  timestamp,
}

describe('критичные API-контракты', () => {
  it('принимает реальные формы основных ответов', () => {
    expect(appConfigSchema.safeParse({ encryption_enabled: true }).success).toBe(true)
    expect(
      authResponseSchema.safeParse({ id: 2, username: 'mikhail', wrapping_key: 'key' }).success,
    ).toBe(true)
    expect(rawEntrySchema.safeParse(rawEntry).success).toBe(true)
    expect(
      groupedEntriesResponseSchema.safeParse({
        results: { '2026-08-24': [rawEntry] },
        next_before: null,
      }).success,
    ).toBe(true)
    expect(
      sharingStatusResponseSchema.safeParse({
        active: true,
        token: 'token',
        created_at: timestamp,
        is_encrypted: true,
      }).success,
    ).toBe(true)
    expect(
      shareDataResponseSchema.safeParse({ data_blob: 'blob', is_encrypted: true }).success,
    ).toBe(true)
    expect(
      shareEntriesSchema.safeParse([{ mood: 7, note: 'Текст', anxiety: 2, timestamp }]).success,
    ).toBe(true)
  })

  it('отклоняет опасные несовместимые ответы', () => {
    expect(appConfigSchema.safeParse({ encryption_enabled: 'true' }).success).toBe(false)
    expect(rawEntrySchema.safeParse({ ...rawEntry, timestamp: 'вчера' }).success).toBe(false)
    expect(
      groupedEntriesResponseSchema.safeParse({ results: { yesterday: [] }, next_before: null })
        .success,
    ).toBe(false)
    expect(
      sharingStatusResponseSchema.safeParse({ active: true, is_encrypted: true }).success,
    ).toBe(false)
    expect(
      shareEntriesSchema.safeParse([{ mood: 10, note: '', anxiety: 0, timestamp }]).success,
    ).toBe(false)
  })
})
