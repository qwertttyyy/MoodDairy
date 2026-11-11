import { useEffect, useRef, useState } from 'react'

import { ANXIETY_LABELS, MAX_ANXIETY, MAX_MOOD, MOOD_LABELS } from '../../shared/constants'
import { isoDateStr, isoTimeStr } from '../../shared/lib/dates'
import { Modal, ModalCloseButton } from '../../shared/ui/Modal'
import { useConfirm } from '../../shared/ui/confirm'
import { useToast } from '../../shared/ui/toast'
import { useGuide } from '../guide/GuideContext'
import { useDeleteEntry, useSaveEntry, useTags } from './api'
import { useEntryModal } from './EntryModalContext'
import { noteUsage } from './noteLimit'

import './entry-form.css'

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
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
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

      <div className={meta.scaleClass} role="group" aria-label={meta.title}>
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
        {value ? meta.labels[value] : <span className="scale-result-empty">{meta.emptyText}</span>}
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
  const confirm = useConfirm()
  const { data: tags, error: tagsError, refetch: refetchTags } = useTags(isOpen)
  const saveEntry = useSaveEntry()
  const deleteEntry = useDeleteEntry()

  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [error, setError] = useState('')
  const [baseline, setBaseline] = useState('')
  const saving = useRef(false)
  const initialTimestamp = useRef<Date | null>(null)

  // Поля, не связанные с оценками, наполняются заново при каждом открытии формы.
  useEffect(() => {
    if (!isOpen) return
    const timestamp = editing ? new Date(editing.timestamp) : new Date()
    initialTimestamp.current = timestamp
    const dateValue = isoDateStr(timestamp)

    const initialNote = editing?.note ?? ''
    const initialTime = clampTime(dateValue, isoTimeStr(timestamp))
    const initialTags = editing ? editing.tags.map((tag) => tag.id) : []
    setBaseline(
      formSnapshot(
        editing?.mood ?? 0,
        editing?.anxiety ?? 0,
        initialNote,
        dateValue,
        initialTime,
        initialTags,
      ),
    )
    setNote(initialNote)
    setDate(dateValue)
    setTime(initialTime)
    setSelectedTagIds(initialTags)
    setError('')
  }, [isOpen, editing])

  const isEditing = editing !== null
  const availableTags = [
    ...(tags ?? []),
    ...(editing?.tags ?? []).filter((tag) => !(tags ?? []).some((item) => item.id === tag.id)),
  ]
  const usage = noteUsage(note)
  const dirty = formSnapshot(mood, anxiety, note, date, time, selectedTagIds) !== baseline
  const pending = saveEntry.isPending || deleteEntry.isPending
  const requestClose = () => {
    if (saving.current || pending) return
    if (!dirty) {
      close()
      return
    }
    confirm({
      title: 'Отменить изменения?',
      text: 'Несохранённые изменения будут потеряны.',
      confirmLabel: 'Не сохранять',
      onConfirm: close,
    })
  }
  useEffect(() => {
    if (!isOpen || !dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isOpen, dirty])
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
    if (!isOpen || !mood || saving.current || pending) return

    if (usage > 1) {
      setError('Заметка слишком длинная. Сократите текст перед сохранением.')
      return
    }

    if (!date || !time) {
      setError('Укажите дату и время')
      return
    }

    const initial = initialTimestamp.current
    const timestamp =
      initial && date === isoDateStr(initial) && time === isoTimeStr(initial)
        ? initial
        : new Date(`${date}T${time}:00`)
    if (Number.isNaN(timestamp.getTime()) || timestamp > new Date()) {
      setError('Дата не может быть в будущем')
      return
    }

    setError('')
    saving.current = true
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
    } finally {
      saving.current = false
    }
  }

  const handleDelete = () => {
    if (!editing) return
    confirm({
      title: 'Удалить запись?',
      text: 'Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        await deleteEntry.mutateAsync(editing.id)
        close()
        showToast('Запись удалена')
      },
    })
  }

  return (
    <Modal
      open={isOpen}
      onClose={requestClose}
      titleId="entry-modal-title"
      closeDisabled={saveEntry.isPending || deleteEntry.isPending}
      className="entry-form"
      overlayClassName="entry-form-overlay"
      morphFrom={origin}
    >
      <div className="modal-handle" />
      <div className="modal-header">
        <h2 id="entry-modal-title" tabIndex={-1}>
          {isEditing ? 'Редактировать' : 'Новая запись'}
        </h2>
        <ModalCloseButton onClick={requestClose} disabled={pending} />
      </div>

      <fieldset className="modal-body entry-fields" disabled={pending}>
        {editing?.syncError && (
          <p className="form-error" role="alert">
            Не удалось отправить запись: {editing.syncError}. Исправьте её и сохраните снова.
          </p>
        )}
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
            aria-invalid={usage > 1}
            aria-describedby={usage > 1 ? 'entry-note-error' : undefined}
            onChange={(event) => setNote(event.target.value)}
          />
          {usage > 0.75 && <p className="note-counter">Объём заметки: {Math.ceil(usage * 100)}%</p>}
          {usage > 1 && (
            <p id="entry-note-error" className="form-error" role="alert">
              Заметка слишком длинная. Сократите текст перед сохранением.
            </p>
          )}
        </div>

        <div className="field-block">
          <div className="field-label-row">
            <span className="field-label">Теги</span>
            <span className="field-hint">(необязательно)</span>
          </div>
          <div className="tag-chips">
            {availableTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={selectedTagIds.includes(tag.id) ? 'tag-chip selected' : 'tag-chip'}
                aria-pressed={selectedTagIds.includes(tag.id)}
                onClick={() => toggleTag(tag.id)}
              >
                {tag.name}
              </button>
            ))}
          </div>
          {tagsError ? (
            <div className="inline-error" role="alert">
              <span>Не удалось загрузить теги</span>
              <button type="button" className="btn-plain" onClick={() => void refetchTags()}>
                Повторить
              </button>
            </div>
          ) : null}
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
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'entry-form-error' : undefined}
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
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'entry-form-error' : undefined}
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

        {error && (
          <div className="form-error" id="entry-form-error" role="alert">
            {error}
          </div>
        )}
      </fieldset>

      <div className="modal-footer">
        {isEditing ? (
          <button
            type="button"
            className="btn-secondary btn-delete-entry"
            onClick={handleDelete}
            disabled={deleteEntry.isPending || saveEntry.isPending}
            aria-busy={deleteEntry.isPending}
          >
            Удалить
          </button>
        ) : null}
        <button
          type="button"
          className="btn-primary"
          onClick={handleSave}
          disabled={!mood || pending || usage > 1}
          aria-busy={saveEntry.isPending}
        >
          {saveEntry.isPending ? 'Сохраняем…' : isEditing ? 'Сохранить' : 'Добавить'}
        </button>
      </div>
    </Modal>
  )
}

function formSnapshot(
  mood: number,
  anxiety: number,
  note: string,
  date: string,
  time: string,
  tags: number[],
): string {
  return JSON.stringify([mood, anxiety, note, date, time, [...tags].sort((a, b) => a - b)])
}
