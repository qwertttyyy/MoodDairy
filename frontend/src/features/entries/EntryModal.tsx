import { useEffect, useState } from 'react'

import {
  ANXIETY_COLORS,
  ANXIETY_EMOJI,
  ANXIETY_LABELS,
  MAX_ANXIETY,
  MAX_MOOD,
  MOOD_COLORS,
  MOOD_EMOJI,
  MOOD_LABELS,
} from '../../shared/constants'
import { isoDateStr, isoTimeStr } from '../../shared/lib/dates'
import { Modal, ModalCloseButton } from '../../shared/ui/Modal'
import { useToast } from '../../shared/ui/ToastProvider'
import { useGuide } from '../guide/GuideContext'
import { useSaveEntry, useTags } from './api'
import { useEntryModal } from './EntryModalContext'

/**
 * Различия двух шкал: классы из styles.css, подписи и палитры.
 * Логика пикеров одинаковая, поэтому она живёт в одном ScaleField.
 */
const SCALES = {
  mood: {
    title: 'Как настроение?',
    hintLabel: 'Подсказка',
    pickerClass: 'mood-picker',
    buttonClass: 'mood-btn',
    max: MAX_MOOD,
    colors: MOOD_COLORS,
    labels: MOOD_LABELS,
    emoji: MOOD_EMOJI,
    emptyText: '—',
  },
  anxiety: {
    title: 'Уровень тревоги',
    hintLabel: 'Подсказка тревоги',
    pickerClass: 'anxiety-picker',
    buttonClass: 'anxiety-btn',
    max: MAX_ANXIETY,
    colors: ANXIETY_COLORS,
    labels: ANXIETY_LABELS,
    emoji: ANXIETY_EMOJI,
    emptyText: '— (необязательно)',
  },
} as const

type ScaleName = keyof typeof SCALES

/**
 * Время в будущем недопустимо: для сегодняшней даты подрезаем до текущего.
 * Порт `EntryModal._enforceDTMax` из старого app.js.
 */
function clampTime(date: string, time: string): string {
  const now = new Date()
  if (date !== isoDateStr(now)) return time
  const maxTime = isoTimeStr(now)
  return time > maxTime ? maxTime : time
}

interface ScaleFieldProps {
  scale: ScaleName
  value: number
  onSelect: (value: number) => void
  onOpenGuide: () => void
}

/** Подпись со ссылкой на памятку, сетка оценок и текст выбранной оценки. */
function ScaleField({ scale, value, onSelect, onOpenGuide }: ScaleFieldProps) {
  const meta = SCALES[scale]
  const grades = Array.from({ length: meta.max }, (_, index) => index + 1)

  return (
    <>
      <div className="mood-label-row">
        <label className="field-label">{meta.title}</label>
        <button
          type="button"
          className="mood-guide-hint"
          onClick={onOpenGuide}
          aria-label={meta.hintLabel}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          Памятка
        </button>
      </div>

      <div className={meta.pickerClass}>
        {grades.map((grade) => (
          <button
            key={grade}
            type="button"
            className={grade === value ? `${meta.buttonClass} selected` : meta.buttonClass}
            style={{ background: meta.colors[grade] }}
            onClick={() => onSelect(grade)}
          >
            {grade}
          </button>
        ))}
      </div>

      <div className="mood-value-display">
        {value ? `${meta.emoji[value]} ${meta.labels[value]}` : meta.emptyText}
      </div>
    </>
  )
}

/**
 * Форма создания и редактирования записи.
 *
 * Порт модуля `EntryModal` из backend/static/app.js. Выбранные оценки хранит
 * EntryModalContext — их выставляет ещё и памятка, открытая поверх формы.
 */
export function EntryModal() {
  const { isOpen, editing, mood, anxiety, close, selectMood, selectAnxiety } = useEntryModal()
  const { open: openGuide } = useGuide()
  const showToast = useToast()
  const { data: tags } = useTags()
  const saveEntry = useSaveEntry()

  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [error, setError] = useState('')

  // Поля, не связанные с оценками, наполняются заново при каждом открытии формы.
  useEffect(() => {
    if (!isOpen) return
    const timestamp = editing ? new Date(editing.timestamp) : new Date()
    const dateValue = isoDateStr(timestamp)

    setNote(editing?.note ?? '')
    setDate(dateValue)
    setTime(clampTime(dateValue, isoTimeStr(timestamp)))
    setSelectedTagIds(editing ? editing.tags.map((tag) => tag.id) : [])
    setError('')
  }, [isOpen, editing])

  const isEditing = editing !== null
  const today = isoDateStr(new Date())
  const timeMax = date === today ? isoTimeStr(new Date()) : undefined

  const toggleTag = (id: number) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((tagId) => tagId !== id) : [...prev, id],
    )
  }

  const handleDateChange = (value: string) => {
    setDate(value)
    setTime((prev) => clampTime(value, prev))
  }

  const handleSave = async () => {
    if (!mood) return

    if (!date || !time) {
      setError('Укажите дату и время')
      return
    }

    const timestamp = new Date(`${date}T${time}:00`)
    if (timestamp > new Date()) {
      setError('Дата не может быть в будущем')
      return
    }

    setError('')
    try {
      await saveEntry.mutateAsync({
        data: {
          mood,
          note: note.trim(),
          anxiety,
          tags: selectedTagIds,
          timestamp: timestamp.toISOString(),
        },
        editId: editing?.id ?? null,
      })
      close()
      showToast(isEditing ? 'Запись обновлена' : 'Запись добавлена')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Произошла ошибка')
    }
  }

  return (
    <Modal open={isOpen} onClose={close}>
      <div className="modal-handle" />
      <div className="modal-header">
        <h2>{isEditing ? 'Редактировать' : 'Новая запись'}</h2>
        <ModalCloseButton onClick={close} />
      </div>

      <div className="modal-body">
        <ScaleField
          scale="mood"
          value={mood}
          onSelect={selectMood}
          onOpenGuide={() => openGuide('mood')}
        />
        <ScaleField
          scale="anxiety"
          value={anxiety}
          onSelect={selectAnxiety}
          onOpenGuide={() => openGuide('anxiety')}
        />

        <label className="field-label" htmlFor="entry-note">
          Заметка
        </label>
        <textarea
          id="entry-note"
          className="glass-input"
          rows={3}
          placeholder="Что произошло?"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        <label className="field-label">
          Теги <span className="field-hint">(необязательно)</span>
        </label>
        <div className="tag-chips">
          {(tags ?? []).map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={selectedTagIds.includes(tag.id) ? 'tag-chip selected' : 'tag-chip'}
              onClick={() => toggleTag(tag.id)}
            >
              {tag.name}
            </button>
          ))}
        </div>

        <label className="field-label">Дата и время</label>
        <div className="datetime-row">
          <input
            type="date"
            className="glass-input dt-input"
            value={date}
            max={today}
            onChange={(event) => handleDateChange(event.target.value)}
          />
          <input
            type="time"
            className="glass-input dt-input"
            value={time}
            max={timeMax}
            onChange={(event) => setTime(clampTime(date, event.target.value))}
          />
        </div>

        {error && <div className="form-error">{error}</div>}
      </div>

      <div className="modal-footer">
        <button
          type="button"
          className="btn-primary"
          onClick={handleSave}
          disabled={!mood || saveEntry.isPending}
        >
          {isEditing ? 'Сохранить' : 'Добавить'}
        </button>
      </div>
    </Modal>
  )
}
