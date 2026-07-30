import { Fragment } from 'react'
import type { MouseEvent } from 'react'

import {
  ANXIETY_COLORS,
  ANXIETY_EMOJI,
  MOOD_COLORS,
  MOOD_EMOJI,
  MOOD_LABELS,
} from '../../shared/constants'
import { formatTime } from '../../shared/lib/dates'
import type { DecryptedEntry } from './types'

interface EntryCardProps {
  entry: DecryptedEntry
  /** Открыть запись на редактирование. */
  onOpen: (entry: DecryptedEntry) => void
  /** Запросить удаление записи. */
  onDelete: (entry: DecryptedEntry) => void
}

/** Карточка записи в ленте: оценка настроения, тревога, заметка, теги и удаление. */
export function EntryCard({ entry, onOpen, onDelete }: EntryCardProps) {
  const { mood, anxiety, note, tags, timestamp } = entry

  function handleDelete(event: MouseEvent<HTMLButtonElement>) {
    // Клик по корзине не должен всплывать до карточки и открывать форму.
    event.stopPropagation()
    onDelete(entry)
  }

  return (
    <div className="entry-card" onClick={() => onOpen(entry)}>
      <div className="entry-mood-badge" style={{ background: MOOD_COLORS[mood] }}>
        <span className="badge-emoji">{MOOD_EMOJI[mood]}</span>
        <span className="badge-num">{mood}</span>
      </div>
      <div className="entry-body">
        <div className="entry-top-row">
          <span className="entry-mood-text">
            {MOOD_LABELS[mood]}
            {anxiety > 0 ? (
              <span
                className="entry-anxiety-badge"
                style={{ background: ANXIETY_COLORS[anxiety] }}
              >
                {`${ANXIETY_EMOJI[anxiety]} ${anxiety}`}
              </span>
            ) : null}
          </span>
          <span className="entry-time">{formatTime(timestamp)}</span>
        </div>
        <div className="entry-card-footer">
          <div className="entry-block-right">
            {note ? <p className="entry-note">{note}</p> : null}
            {tags.length > 0 ? (
              <div className="entry-block-tags">
                {/* Теги разделены пробелом: .entry-tag — inline-block без внешних отступов. */}
                {tags.map((tag, index) => (
                  <Fragment key={tag.id}>
                    {index > 0 ? ' ' : null}
                    <span className="entry-tag">#{tag.name}</span>
                  </Fragment>
                ))}
              </div>
            ) : null}
          </div>
          <button className="entry-delete-btn" onClick={handleDelete} aria-label="Удалить">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
