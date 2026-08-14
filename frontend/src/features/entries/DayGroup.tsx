import { Fragment, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

import { dayLabel } from '../../shared/lib/dates'
import { EntryCard } from './EntryCard'
import { moodClass } from './scale'
import type { DecryptedEntry, EntryDayGroup } from './types'

/** Запасная высота верхней панели, если computed-значение прочитать не удалось. */
const FALLBACK_TOP = 52

/**
 * Прилип ли липкий заголовок к верхней панели.
 *
 * Наблюдатель следит за самим заголовком, а верхняя граница области наблюдения
 * поднята до линии прилипания: пока заголовок ниже её, он виден целиком
 * (ratio = 1); как только упирается в панель — часть его уходит за границу.
 */
function useStickyPinned(target: HTMLElement | null): boolean {
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    if (!target) return
    // У sticky-элемента computed top уже посчитан в пикселях.
    const top = Number.parseFloat(getComputedStyle(target).top)
    const line = Number.isFinite(top) ? top : FALLBACK_TOP

    const observer = new IntersectionObserver(
      ([record]) => {
        const box = record.boundingClientRect
        // У скрытого таба (display:none) прямоугольник нулевой, а верх равен
        // нулю — без проверки высоты все заголовки скрытой ленты считались бы
        // прилипшими и мигали сводкой при возврате на таб.
        if (box.height === 0) return
        // Заголовки ниже экрана тоже видны не целиком, поэтому одной доли мало:
        // прилипшим считаем только тот, что дошёл до линии прилипания.
        setPinned(record.intersectionRatio < 1 && box.top <= line + 1)
      },
      { rootMargin: `-${line + 1}px 0px 0px 0px`, threshold: [1] },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [target])

  return pinned
}

interface DayGroupProps {
  group: EntryDayGroup
  onOpen: (entry: DecryptedEntry) => void
  onDelete: (entry: DecryptedEntry) => void
}

/** Записи одного дня: липкий заголовок и одна общая группа строк под ним. */
export function DayGroup({ group, onOpen, onDelete }: DayGroupProps) {
  const [head, setHead] = useState<HTMLElement | null>(null)
  const pinned = useStickyPinned(head)

  return (
    <section className="feed-day">
      <h3 className={pinned ? 'feed-dayhead is-pinned' : 'feed-dayhead'} ref={setHead}>
        <span className="feed-dayhead-text">{dayLabel(group.day)}</span>
        {/* Сводка дня: по сегменту на запись, цвет — оценка настроения.
            Видна только в прилипшем состоянии. Число записей отдаём в CSS
            переменной: ширину полосы из пустых сегментов иначе не посчитать. */}
        <span
          className="feed-strip"
          style={{ '--n': String(group.entries.length) } as CSSProperties}
          aria-hidden="true"
        >
          {group.entries.map((entry) => (
            <i key={entry.id} className={moodClass(entry.mood)} />
          ))}
        </span>
      </h3>

      <div className="feed-group">
        {group.entries.map((entry, index) => (
          <Fragment key={entry.id}>
            {index > 0 ? <div className="feed-sep" /> : null}
            <EntryCard entry={entry} onOpen={onOpen} onDelete={onDelete} />
          </Fragment>
        ))}
      </div>
    </section>
  )
}
