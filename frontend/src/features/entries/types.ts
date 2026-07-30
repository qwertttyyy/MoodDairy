import type { Tag } from '../../shared/api/types'

/** Запись после расшифровки: оценки — числа, заметка — открытый текст. */
export interface DecryptedEntry {
  id: number
  mood: number
  note: string
  anxiety: number
  tags: Tag[]
  timestamp: string
}

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
  entries: DecryptedEntry[]
}
