/** Формы ответов DRF. Контракт API менять нельзя — сверено с views.py приложений бэкенда. */

export interface AppConfig {
  encryption_enabled: boolean
}

export interface AuthUser {
  id: number
  username: string
}

export interface AuthResponse extends AuthUser {
  wrapping_key: string
}

export interface ProfileResponse {
  encryption_salt: string
}

export interface WrappingKeyResponse {
  wrapping_key: string
}

export interface Tag {
  id: number
  name: string
}

/** Запись «как в БД»: mood / note / anxiety — шифротекст `ivB64:ctB64`. */
export interface RawEntry {
  id: number
  mood: string
  note: string
  anxiety: string
  tags: Tag[]
  timestamp: string
}

/**
 * Запись для графика: `GET /api/entries/` отдаёт только то, что нужно кривой.
 * Заметок и тегов здесь нет — они весят больше остального вместе взятого.
 */
export interface ChartRawEntry {
  id: number
  mood: string
  anxiety: string
  timestamp: string
}

/**
 * Запись снапшота: `GET /api/entries/snapshot/` отдаёт всю историю со всеми
 * полями — это единственный источник для сборки ссылки врачу.
 */
export interface SnapshotRawEntry {
  mood: string
  note: string
  anxiety: string
  timestamp: string
}

export interface GroupedEntriesResponse {
  results: Record<string, RawEntry[]>
  next_before: string | null
}

export interface DateRangeResponse {
  first_date: string | null
}

export type SharingStatusResponse =
  | { active: false }
  | { active: true; token: string; created_at: string; is_encrypted: boolean }

export interface CreateShareResponse {
  token: string
}

export interface ShareDataResponse {
  data_blob: string
  is_encrypted: boolean
}

/** Расшифрованная запись в снапшоте для врача. */
export interface ShareEntry {
  mood: number
  note: string
  anxiety: number
  timestamp: string
}
