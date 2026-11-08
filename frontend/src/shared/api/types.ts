import * as z from 'zod/mini'

/** Runtime-контракты всех успешных ответов API. */

const idSchema = z.int().check(z.positive())
const timestampSchema = z.iso.datetime({ offset: true })

export const appConfigSchema = z.object({ encryption_enabled: z.boolean() })
export type AppConfig = z.infer<typeof appConfigSchema>

export const authUserSchema = z.object({ id: idSchema, username: z.string().check(z.minLength(1)) })
export type AuthUser = z.infer<typeof authUserSchema>

export const authResponseSchema = z.extend(authUserSchema, {
  wrapping_key: z.string().check(z.minLength(1)),
})
export type AuthResponse = z.infer<typeof authResponseSchema>

export const profileResponseSchema = z.object({ encryption_salt: z.string() })
export type ProfileResponse = z.infer<typeof profileResponseSchema>

export const wrappingKeyResponseSchema = z.object({
  wrapping_key: z.string().check(z.minLength(1)),
})
export type WrappingKeyResponse = z.infer<typeof wrappingKeyResponseSchema>

export const tagSchema = z.object({
  id: idSchema,
  name: z.string().check(z.minLength(1), z.maxLength(50)),
})
export type Tag = z.infer<typeof tagSchema>

export const rawEntrySchema = z.object({
  id: idSchema,
  mood: z.string(),
  note: z.string(),
  anxiety: z.string(),
  tags: z.array(tagSchema),
  timestamp: timestampSchema,
})
export type RawEntry = z.infer<typeof rawEntrySchema>

export const chartRawEntrySchema = z.object({
  mood: z.string(),
  anxiety: z.string(),
  timestamp: timestampSchema,
})
export type ChartRawEntry = z.infer<typeof chartRawEntrySchema>

export const snapshotRawEntrySchema = z.object({
  mood: z.string(),
  note: z.string(),
  anxiety: z.string(),
  timestamp: timestampSchema,
})
export type SnapshotRawEntry = z.infer<typeof snapshotRawEntrySchema>

export const groupedEntriesResponseSchema = z.object({
  results: z.record(z.iso.date(), z.array(rawEntrySchema)),
  next_before: z.nullable(z.iso.date()),
})
export type GroupedEntriesResponse = z.infer<typeof groupedEntriesResponseSchema>

export const dateRangeResponseSchema = z.object({ first_date: z.nullable(z.iso.date()) })
export type DateRangeResponse = z.infer<typeof dateRangeResponseSchema>

export const sharingStatusResponseSchema = z.discriminatedUnion('active', [
  z.object({ active: z.literal(false) }),
  z.object({
    active: z.literal(true),
    token: z.string().check(z.minLength(1)),
    created_at: timestampSchema,
    is_encrypted: z.boolean(),
  }),
])
export type SharingStatusResponse = z.infer<typeof sharingStatusResponseSchema>

export const createShareResponseSchema = z.object({ token: z.string().check(z.minLength(1)) })
export type CreateShareResponse = z.infer<typeof createShareResponseSchema>

export const shareDataResponseSchema = z.object({
  data_blob: z.string().check(z.minLength(1)),
  is_encrypted: z.boolean(),
})
export type ShareDataResponse = z.infer<typeof shareDataResponseSchema>

export const shareEntrySchema = z.object({
  mood: z.int().check(z.minimum(1), z.maximum(9)),
  note: z.string(),
  anxiety: z.int().check(z.minimum(0), z.maximum(5)),
  timestamp: timestampSchema,
})
export const shareEntriesSchema = z.array(shareEntrySchema)
export type ShareEntry = z.infer<typeof shareEntrySchema>

export const tagsSchema = z.array(tagSchema)
export const chartRawEntriesSchema = z.array(chartRawEntrySchema)
export const snapshotRawEntriesSchema = z.array(snapshotRawEntrySchema)
export const voidResponseSchema = z.undefined()
