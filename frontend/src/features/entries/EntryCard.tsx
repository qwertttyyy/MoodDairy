import { ANXIETY_LABELS, MOOD_LABELS } from '../../shared/constants'
import { formatTime } from '../../shared/lib/dates'
import { moodClass } from './scale'
import type { DecryptedEntry } from './types'
import { useSwipeAction } from './useSwipeAction'

/** Ширина кнопки удаления: на столько же сдвигается строка при свайпе. */
const ACTION_WIDTH = 88

interface EntryCardProps {
  entry: DecryptedEntry
  /** Открыть запись на редактирование. */
  onOpen: (entry: DecryptedEntry) => void
  /** Запросить удаление записи. */
  onDelete: (entry: DecryptedEntry) => void
}

/**
 * Строка записи в группе дня: оценка настроения, тревога, время, заметка и теги.
 * Тап открывает запись, свайп влево — кнопку удаления.
 */
export function EntryCard({ entry, onOpen, onDelete }: EntryCardProps) {
  const { mood, anxiety, note, tags, timestamp } = entry
  const swipe = useSwipeAction(ACTION_WIDTH)

  function handleClick() {
    // Клик после свайпа — не тап: строка уже отреагировала сдвигом.
    if (swipe.consumeGesture()) return
    if (swipe.shifted) {
      swipe.close()
      return
    }
    onOpen(entry)
  }

  function handleDelete() {
    swipe.close()
    onDelete(entry)
  }

  return (
    <div className="feed-rw">
      {swipe.shifted ? (
        <button type="button" className="feed-del" onClick={handleDelete}>
          Удалить
        </button>
      ) : null}

      <button
        type="button"
        className={swipe.dragging ? 'feed-row is-dragging' : 'feed-row'}
        style={{ transform: `translateX(${swipe.offset}px)` }}
        onClick={handleClick}
        {...swipe.handlers}
      >
        <span className={`feed-badge ${moodClass(mood)}`}>{mood}</span>

        <span className="feed-body">
          <span className="feed-line">
            <span className="feed-mood">{MOOD_LABELS[mood]}</span>
            {anxiety > 0 ? (
              <span className={`feed-anx a${anxiety}`} title={ANXIETY_LABELS[anxiety]}>
                {anxiety}
              </span>
            ) : null}
            <span className="feed-time">{formatTime(timestamp)}</span>
          </span>

          {note ? <span className="feed-note">{note}</span> : null}

          {tags.length > 0 ? (
            <span className="feed-tags">
              {tags.map((tag) => (
                <span key={tag.id}>#{tag.name}</span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
    </div>
  )
}
