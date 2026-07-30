/**
 * Страница врача: просмотр снапшота дневника по ссылке, только чтение.
 * Порт backend/templates/share.html + backend/static/share.js.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'

import { ChartStats } from '../../features/chart/ChartStats'
import { MoodChart } from '../../features/chart/MoodChart'
import type { ShareEntry } from '../../shared/api/types'
import {
  ANXIETY_COLORS,
  ANXIETY_EMOJI,
  MONTH_NAMES,
  MOOD_COLORS,
  MOOD_EMOJI,
  MOOD_LABELS,
} from '../../shared/constants'
import { dayLabelPlain, formatTime } from '../../shared/lib/dates'
import { clampMonth, compareMonths, getMonthBounds, monthOf, shiftMonth } from './month'
import type { YearMonth } from './month'
import { MissingKeyError, loadShareEntries, readShareKeyFromHash } from './snapshot'

const INVALID_LINK_TITLE = 'Ссылка недействительна'
const MISSING_KEY_TITLE = 'Ключ отсутствует'

/** Три состояния страницы — как три блока в share.html. */
type PageState =
  | { status: 'loading' }
  | { status: 'error'; title: string }
  | { status: 'ready'; entries: ShareEntry[] }

export function SharePage() {
  const { token } = useParams<'token'>()
  const [state, setState] = useState<PageState>({ status: 'loading' })

  useSystemTheme()

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', title: INVALID_LINK_TITLE })
      return
    }

    // Ключ читаем прямо здесь и не храним в состоянии: он не должен попасть ни в запрос, ни в лог.
    const shareKey = readShareKeyFromHash()
    let cancelled = false

    loadShareEntries(token, shareKey)
      .then((entries) => {
        if (!cancelled) setState({ status: 'ready', entries })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const title = error instanceof MissingKeyError ? MISSING_KEY_TITLE : INVALID_LINK_TITLE
        setState({ status: 'error', title })
      })

    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="share-page">
      {state.status === 'loading' ? <ShareLoading /> : null}
      {state.status === 'error' ? <ShareError title={state.title} /> : null}
      {state.status === 'ready' ? <ShareContent entries={state.entries} /> : null}
    </div>
  )
}

/**
 * Тема только по системной настройке: страница врача ничего не читает
 * и не пишет в настройки пользователя и localStorage.
 */
function useSystemTheme(): void {
  useEffect(() => {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark')
    }
  }, [])
}

function ShareLoading() {
  return (
    <div className="share-loading">
      <div className="spinner" />
      <p style={{ marginTop: '12px', color: 'var(--c-secondary)', fontSize: '0.85rem' }}>
        Загрузка…
      </p>
    </div>
  )
}

function ShareError({ title }: { title: string }) {
  return (
    <div className="share-error">
      <div className="empty-state">
        <div className="empty-icon">🔒</div>
        <p className="empty-title">{title}</p>
        <p className="empty-sub">Запросите новую ссылку у пациента</p>
      </div>
    </div>
  )
}

function ShareContent({ entries }: { entries: ShareEntry[] }) {
  const bounds = useMemo(() => getMonthBounds(entries), [entries])
  const [month, setMonth] = useState<YearMonth>(bounds.max)

  const monthEntries = useMemo(
    () => entries.filter((entry) => compareMonths(monthOf(entry.timestamp), month) === 0),
    [entries, month],
  )
  const dayGroups = useMemo(() => groupByDay(monthEntries), [monthEntries])

  const atMin = compareMonths(month, bounds.min) === 0
  const atMax = compareMonths(month, bounds.max) === 0

  function moveMonth(direction: 1 | -1) {
    setMonth((current) => clampMonth(shiftMonth(current, direction), bounds))
  }

  return (
    <div className="share-content">
      <header className="share-header liquid-glass">
        <h1 className="app-title">Moods</h1>
        <span className="share-badge">Просмотр</span>
      </header>

      <div className="month-picker">
        <div className="month-picker-inner liquid-glass">
          <MonthNavButton direction={-1} disabled={atMin} onClick={() => moveMonth(-1)} />
          <span className="month-label">{`${MONTH_NAMES[month.month - 1]} ${month.year}`}</span>
          <MonthNavButton direction={1} disabled={atMax} onClick={() => moveMonth(1)} />
        </div>
      </div>

      {monthEntries.length > 0 ? (
        <>
          <MoodChart entries={monthEntries} smooth isMonthMode />
          <ChartStats entries={monthEntries} showAnxiety />
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <p className="empty-title">Нет записей за этот месяц</p>
        </div>
      )}

      {/* Подписи дней и карточки — плоские соседи: .share-entries раздаёт им gap. */}
      <div className="share-entries">
        {dayGroups.map((group) => (
          <Fragment key={group.day}>
            <div className="date-group-label">{dayLabelPlain(group.day)}</div>
            {group.items.map((entry, index) => (
              <ShareEntryCard key={`${group.day}-${index}`} entry={entry} />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

interface MonthNavButtonProps {
  /** -1 — предыдущий месяц, 1 — следующий. */
  direction: 1 | -1
  disabled: boolean
  onClick: () => void
}

function MonthNavButton({ direction, disabled, onClick }: MonthNavButtonProps) {
  return (
    <button
      className="month-nav-btn"
      disabled={disabled}
      // Порт share.js: на границе кнопка не только заблокирована, но и приглушена.
      style={{ opacity: disabled ? '0.3' : '1' }}
      onClick={onClick}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points={direction === -1 ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
      </svg>
    </button>
  )
}

function ShareEntryCard({ entry }: { entry: ShareEntry }) {
  const mood = entry.mood || 0
  const anxiety = entry.anxiety || 0

  return (
    <div className="share-entry-card">
      <div className="entry-mood-badge" style={{ background: MOOD_COLORS[mood] }}>
        <span className="badge-emoji">{MOOD_EMOJI[mood]}</span>
        <span className="badge-num">{mood}</span>
      </div>
      <div className="share-entry-body">
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
          <span className="entry-time">{formatTime(entry.timestamp)}</span>
        </div>
        {entry.note ? <p className="share-entry-note">{entry.note}</p> : null}
      </div>
    </div>
  )
}

/** Записи одного дня (`YYYY-MM-DD` из метки времени). */
interface DayGroup {
  day: string
  items: ShareEntry[]
}

/**
 * Группирует записи по дням, сохраняя порядок.
 * Вход отсортирован по возрастанию, поэтому дни идут по возрастанию и без разрывов.
 */
function groupByDay(entries: ShareEntry[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const entry of entries) {
    const day = entry.timestamp.slice(0, 10)
    const last = groups.at(-1)
    if (last && last.day === day) last.items.push(entry)
    else groups.push({ day, items: [entry] })
  }
  return groups
}
