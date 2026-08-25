import { describe, expect, it } from 'vitest'

import {
  appConfigSchema,
  authResponseSchema,
  authUserSchema,
  chartRawEntriesSchema,
  createShareResponseSchema,
  dateRangeResponseSchema,
  groupedEntriesResponseSchema,
  profileResponseSchema,
  rawEntrySchema,
  shareDataResponseSchema,
  shareEntriesSchema,
  sharingStatusResponseSchema,
  snapshotRawEntriesSchema,
  tagsSchema,
  wrappingKeyResponseSchema,
} from './types'

const timestamp = '2026-08-24T20:30:00+00:00'
const tag = { id: 1, name: 'Работа' }
const rawEntry = {
  id: 7,
  mood: 'iv:mood',
  note: '',
  anxiety: '',
  tags: [tag],
  timestamp,
}

describe('успешные API-контракты', () => {
  it.each([
    ['config', appConfigSchema, { encryption_enabled: true }],
    ['me', authUserSchema, { id: 2, username: 'mikhail' }],
    ['login/register', authResponseSchema, { id: 2, username: 'mikhail', wrapping_key: 'key' }],
    ['profile', profileResponseSchema, { encryption_salt: 'salt' }],
    ['unwrap key', wrappingKeyResponseSchema, { wrapping_key: 'key' }],
    ['tags', tagsSchema, [tag]],
    ['entry', rawEntrySchema, rawEntry],
    ['chart', chartRawEntriesSchema, [{ mood: 'mood', anxiety: '', timestamp }]],
    ['snapshot', snapshotRawEntriesSchema, [{ mood: 'mood', note: '', anxiety: '', timestamp }]],
    [
      'grouped feed',
      groupedEntriesResponseSchema,
      { results: { '2026-08-24': [rawEntry] }, next_before: '2026-08-20' },
    ],
    ['date range', dateRangeResponseSchema, { first_date: null }],
    ['inactive share', sharingStatusResponseSchema, { active: false }],
    [
      'active share',
      sharingStatusResponseSchema,
      { active: true, token: 'token', created_at: timestamp, is_encrypted: true },
    ],
    ['create share', createShareResponseSchema, { token: 'token' }],
    ['public share', shareDataResponseSchema, { data_blob: 'blob', is_encrypted: true }],
    ['public entries', shareEntriesSchema, [{ mood: 7, note: 'Текст', anxiety: 2, timestamp }]],
  ] as const)('принимает %s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(true)
  })

  it('игнорирует новые поля ответа для обратной совместимости', () => {
    expect(appConfigSchema.parse({ encryption_enabled: true, future_option: 1 })).toEqual({
      encryption_enabled: true,
    })
  })
})

describe('несовместимые API-ответы', () => {
  it.each([
    ['config без boolean', appConfigSchema, { encryption_enabled: 'true' }],
    ['пользователь без id', authUserSchema, { username: 'name' }],
    ['пустой wrapping key', wrappingKeyResponseSchema, { wrapping_key: '' }],
    ['тег без имени', tagsSchema, [{ id: 1 }]],
    ['запись с невалидной датой', rawEntrySchema, { ...rawEntry, timestamp: 'вчера' }],
    [
      'grouped с плохим ключом даты',
      groupedEntriesResponseSchema,
      { results: { yesterday: [] }, next_before: null },
    ],
    [
      'активная ссылка без токена',
      sharingStatusResponseSchema,
      { active: true, is_encrypted: true },
    ],
    [
      'публичная оценка вне шкалы',
      shareEntriesSchema,
      [{ mood: 10, note: '', anxiety: 0, timestamp }],
    ],
  ] as const)('отклоняет %s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false)
  })
})
