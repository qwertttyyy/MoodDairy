import { useRef } from 'react'
import type { KeyboardEvent } from 'react'

import {
  ANXIETY_GUIDE,
  ANXIETY_LABELS,
  MAX_ANXIETY,
  MAX_MOOD,
  MOOD_GUIDE,
  MOOD_LABELS,
} from '../../shared/constants'
import { Modal, ModalCloseButton } from '../../shared/ui/Modal'
import { useEntryModal } from '../entries/EntryModalContext'
import { useGuide } from './GuideContext'
import type { GuideTab } from './GuideContext'

/** Данные шкал для памятки: подпись таба, префикс класса цвета, названия и описания. */
const SCALES: Record<
  GuideTab,
  {
    tabTitle: string
    max: number
    /** Префикс класса заливки бейджа: m1…m9 для настроения, p1…p5 для тревоги. */
    colorClass: string
    labels: string[]
    descriptions: string[]
  }
> = {
  mood: {
    tabTitle: 'Настроение',
    max: MAX_MOOD,
    colorClass: 'm',
    labels: MOOD_LABELS,
    descriptions: MOOD_GUIDE,
  },
  anxiety: {
    tabTitle: 'Тревога',
    max: MAX_ANXIETY,
    colorClass: 'p',
    labels: ANXIETY_LABELS,
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
  const titleRef = useRef<HTMLHeadingElement>(null)

  const scale = SCALES[tab]
  // Список идёт от максимума к 1: сверху лучшая оценка — как в старом фронте.
  const grades = Array.from({ length: scale.max }, (_, index) => scale.max - index)

  const pickGrade = (grade: number) => {
    if (tab === 'mood') selectMood(grade)
    else selectAnxiety(grade)
    close()
  }

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + direction + TABS.length) % TABS.length
    const next = TABS[nextIndex]
    if (!next) return
    setTab(next)
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(nextIndex)
      .focus()
  }

  return (
    <Modal
      open={isOpen}
      onClose={close}
      titleId="guide-modal-title"
      initialFocusRef={titleRef}
      className="modal-guide"
    >
      <div className="modal-handle" />
      <div className="modal-header">
        <h2 id="guide-modal-title" ref={titleRef} tabIndex={-1}>
          Памятка
        </h2>
        <ModalCloseButton onClick={close} />
      </div>

      <div className="guide-tabs" role="tablist" aria-label="Шкала памятки">
        {TABS.map((name, index) => (
          <button
            key={name}
            type="button"
            id={`guide-tab-${name}`}
            role="tab"
            aria-selected={name === tab}
            aria-controls="guide-panel"
            tabIndex={name === tab ? 0 : -1}
            className={name === tab ? 'guide-tab-btn active' : 'guide-tab-btn'}
            onClick={() => setTab(name)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            {SCALES[name].tabTitle}
          </button>
        ))}
      </div>

      <div
        className="modal-body mood-guide-list"
        id="guide-panel"
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`guide-tab-${tab}`}
      >
        {isEntryFormOpen && <p className="guide-select-hint">Нажми на оценку, чтобы выбрать</p>}
        {grades.map((grade) => {
          const content = (
            <>
              <div className={`guide-badge ${scale.colorClass}${grade}`}>{grade}</div>
              <div className="guide-text">
                <strong>{scale.labels[grade]}</strong>
                <p>{scale.descriptions[grade]}</p>
              </div>
            </>
          )
          return isEntryFormOpen ? (
            <button
              key={grade}
              type="button"
              className="guide-item guide-item-clickable"
              onClick={() => pickGrade(grade)}
            >
              {content}
            </button>
          ) : (
            <div key={grade} className="guide-item">
              {content}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
