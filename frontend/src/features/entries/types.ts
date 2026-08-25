import type { Tag } from '../../shared/api/types'

/** Запись после расшифровки: оценки — числа, заметка — открытый текст. */
export interface DecryptedEntry {
  kind: 'ready'
  id: number
  mood: number
  note: string
  anxiety: number
  tags: Tag[]
  timestamp: string
}

/** Только безопасные метаданные записи, содержимое которой открыть нельзя. */
export interface CorruptedEntry {
  kind: 'corrupted'
  id: number
  timestamp: string
}

export type EntryResult = DecryptedEntry | CorruptedEntry

/** Данные из формы записи перед шифрованием. */
export interface EntryFormData {
  mood: number
  note: string
  anxiety: number
  tags: number[]
  /** ISO-строка. */
  timestamp: string
}

/** Записи одного дня в ленте. `day` — «YYYY-MM-DD». */
export interface EntryDayGroup {
  day: string
  entries: EntryResult[]
}
