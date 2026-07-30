import {
  ANXIETY_COLORS,
  ANXIETY_EMOJI,
  ANXIETY_GUIDE,
  ANXIETY_LABELS,
  MAX_ANXIETY,
  MAX_MOOD,
  MOOD_COLORS,
  MOOD_EMOJI,
  MOOD_GUIDE,
  MOOD_LABELS,
} from '../../shared/constants'
import { Modal, ModalCloseButton } from '../../shared/ui/Modal'
import { useEntryModal } from '../entries/EntryModalContext'
import { useGuide } from './GuideContext'
import type { GuideTab } from './GuideContext'

/** Данные шкал для памятки: подпись таба, палитра, эмодзи, названия и описания оценок. */
const SCALES: Record<
  GuideTab,
  {
    tabTitle: string
    max: number
    colors: string[]
    labels: string[]
    emoji: string[]
    descriptions: string[]
  }
> = {
  mood: {
    tabTitle: 'Настроение',
    max: MAX_MOOD,
    colors: MOOD_COLORS,
    labels: MOOD_LABELS,
    emoji: MOOD_EMOJI,
    descriptions: MOOD_GUIDE,
  },
  anxiety: {
    tabTitle: 'Тревога',
    max: MAX_ANXIETY,
    colors: ANXIETY_COLORS,
    labels: ANXIETY_LABELS,
    emoji: ANXIETY_EMOJI,
    descriptions: ANXIETY_GUIDE,
  },
}

const TABS: GuideTab[] = ['mood', 'anxiety']

/**
 * Памятка по шкалам настроения и тревоги.
 *
 * Порт модуля `MoodGuide` из backend/static/app.js. Если памятка открыта поверх
 * формы записи, оценки становятся кликабельными и выбор уходит в форму.
 */
export function MoodGuideModal() {
  const { isOpen, tab, close, setTab } = useGuide()
  const { isOpen: isEntryFormOpen, selectMood, selectAnxiety } = useEntryModal()

  const scale = SCALES[tab]
  // Список идёт от максимума к 1: сверху лучшая оценка — как в старом фронте.
  const grades = Array.from({ length: scale.max }, (_, index) => scale.max - index)

  const pickGrade = (grade: number) => {
    if (tab === 'mood') selectMood(grade)
    else selectAnxiety(grade)
    close()
  }

  return (
    <Modal open={isOpen} onClose={close} className="modal-guide">
      <div className="modal-handle" />
      <div className="modal-header">
        <h2>Памятка</h2>
        <ModalCloseButton onClick={close} />
      </div>

      <div className="guide-tabs">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            className={name === tab ? 'guide-tab-btn active' : 'guide-tab-btn'}
            onClick={() => setTab(name)}
          >
            {SCALES[name].tabTitle}
          </button>
        ))}
      </div>

      <div className="modal-body mood-guide-list">
        {isEntryFormOpen && <p className="guide-select-hint">Нажми на оценку, чтобы выбрать</p>}
        {grades.map((grade) => (
          <div
            key={grade}
            className={isEntryFormOpen ? 'guide-item guide-item-clickable' : 'guide-item'}
            onClick={isEntryFormOpen ? () => pickGrade(grade) : undefined}
          >
            <div className="guide-badge" style={{ background: scale.colors[grade] }}>
              <span>{scale.emoji[grade]}</span>
              <span className="guide-badge-num">{grade}</span>
            </div>
            <div className="guide-text">
              <strong>{scale.labels[grade]}</strong>
              <p>{scale.descriptions[grade]}</p>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
