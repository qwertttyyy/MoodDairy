import { useEffect, useState } from 'react'

import { ANXIETY_LABELS, MAX_ANXIETY, MAX_MOOD, MOOD_LABELS } from '../../shared/constants'
import { isoDateStr, isoTimeStr } from '../../shared/lib/dates'
import { Modal, ModalCloseButton } from '../../shared/ui/Modal'
import { useToast } from '../../shared/ui/ToastProvider'
import { useGuide } from '../guide/GuideContext'
import { useSaveEntry, useTags } from './api'
import { useEntryModal } from './EntryModalContext'

/**
 * Различия двух шкал: классы, подписи и палитры.
 * Логика пикеров одинаковая, поэтому она живёт в одном ScaleField.
 *
 * `colorClass` — префикс класса заливки из base.css: `.m1…m9` у настроения,
 * `.p1…p5` у тревоги. Цвета различаются между темами, поэтому задавать их
 * инлайновым стилем нельзя.
 */
const SCALES = {
  mood: {
    title: 'Как настроение?',
    hintLabel: 'Подсказка',
    scaleClass: 'mood-scale',
    colorClass: 'm',
    max: MAX_MOOD,
    labels: MOOD_LABELS,
    emptyText: '—',
  },
  anxiety: {
    title: 'Уровень тревоги',
    hintLabel: 'Подсказка тревоги',
    scaleClass: 'anxiety-scale',
    colorClass: 'p',
    max: MAX_ANXIETY,
    labels: ANXIETY_LABELS,
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

/** Иконка-кружок рядом с надписью «Памятка». */
function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <circle cx="12" cy="7.4" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

interface ScaleFieldProps {
  scale: ScaleName
  value: number
  onSelect: (value: number) => void
  onOpenGuide: () => void
}

/** Подпись со ссылкой на памятку, ряд оценок и строка выбранной оценки. */
function ScaleField({ scale, value, onSelect, onOpenGuide }: ScaleFieldProps) {
  const meta = SCALES[scale]
  const grades = Array.from({ length: meta.max }, (_, index) => index + 1)

  return (
    <div className="field-block">
      <div className="field-label-row">
        <span className="field-label">{meta.title}</span>
        <button
          type="button"
          className="field-guide-btn"
          onClick={onOpenGuide}
          aria-label={meta.hintLabel}
        >
          <InfoIcon />
          Памятка
        </button>
      </div>

      <div className={meta.scaleClass}>
        {grades.map((grade) => {
          const classes = ['scale-cell', `${meta.colorClass}${grade}`]
          if (grade === value) classes.push('selected')
          return (
            <button
              key={grade}
              type="button"
              className={classes.join(' ')}
              aria-pressed={grade === value}
              onClick={() => onSelect(grade)}
            >
              {grade}
            </button>
          )
        })}
      </div>

      <div className="scale-result">
        {value ? (
          meta.labels[value]
        ) : (
          <span className="scale-result-empty">{meta.emptyText}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Форма создания и редактирования записи.
 *
 * Порт модуля `EntryModal` из backend/static/app.js. Выбранные оценки хранит
 * EntryModalContext — их выставляет ещё и памятка, открытая поверх формы.
 */
export function EntryModal() {
  const { isOpen, editing, mood, anxiety, origin, close, selectMood, selectAnxiety } =
    useEntryModal()
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
    <Modal open={isOpen} onClose={close} className="entry-form" morphFrom={origin}>
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

        <div className="field-block">
          <div className="field-label-row">
            <label className="field-label" htmlFor="entry-note">
              Заметка
            </label>
          </div>
          <textarea
            id="entry-note"
            className="glass-input entry-note"
            placeholder="Что произошло?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <div className="field-block">
          <div className="field-label-row">
            <span className="field-label">Теги</span>
            <span className="field-hint">(необязательно)</span>
          </div>
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
        </div>

        <div className="field-block">
          <div className="field-label-row">
            <span className="field-label">Дата и время</span>
          </div>
          <div className="datetime-row">
            <div className="dt-field">
              <input
                type="date"
                value={date}
                max={today}
                aria-label="Дата записи"
                onChange={(event) => handleDateChange(event.target.value)}
              />
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <rect x="3.6" y="5.2" width="16.8" height="15.2" rx="3.4" />
                <path d="M3.6 10h16.8M8.4 3.6v3M15.6 3.6v3" />
              </svg>
            </div>
            <div className="dt-field">
              <input
                type="time"
                value={time}
                max={timeMax}
                aria-label="Время записи"
                onChange={(event) => setTime(clampTime(date, event.target.value))}
              />
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="8.6" />
                <path d="M12 7.2V12l3.2 2" />
              </svg>
            </div>
          </div>
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
