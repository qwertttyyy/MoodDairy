/**
 * Страница врача: просмотр снапшота дневника по ссылке, только чтение.
 * Порт backend/templates/share.html + backend/static/share.js.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'

import { ChartStats } from '../../features/chart/ChartStats'
import { MoodChart } from '../../features/chart/MoodChart'
import type { ShareEntry } from '../../shared/api/types'
import { MONTH_NAMES, MOOD_LABELS } from '../../shared/constants'
import { dayLabelPlain, formatTime } from '../../shared/lib/dates'
import { ChartIcon, LockIcon } from '../../shared/ui/EmptyStateIcons'
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
      <header className="share-header">
        <span className="share-header-title">Moods</span>
        <span className="share-readonly">только чтение</span>
      </header>

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
      <p className="share-loading-text">Загрузка…</p>
    </div>
  )
}

function ShareError({ title }: { title: string }) {
  return (
    <div className="share-error">
      <div className="empty-state">
        <div className="empty-icon">
          <LockIcon />
        </div>
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
      <div className="share-monthnav">
        <MonthNavButton direction={-1} disabled={atMin} onClick={() => moveMonth(-1)} />
        <span className="share-month-label">{`${MONTH_NAMES[month.month - 1]} ${month.year}`}</span>
        <MonthNavButton direction={1} disabled={atMax} onClick={() => moveMonth(1)} />
      </div>

      {monthEntries.length > 0 ? (
        <>
          <MoodChart entries={monthEntries} smooth isMonthMode />
          <ChartStats entries={monthEntries} showAnxiety />
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">
            <ChartIcon />
          </div>
          <p className="empty-title">Нет записей за этот месяц</p>
        </div>
      )}

      {dayGroups.map((group) => (
        <Fragment key={group.day}>
          <div className="share-dayhead">{dayLabelPlain(group.day)}</div>
          <div className="share-group">
            {group.items.map((entry, index) => (
              <Fragment key={`${group.day}-${index}`}>
                {index > 0 ? <div className="share-sep" /> : null}
                <ShareEntryRow entry={entry} />
              </Fragment>
            ))}
          </div>
        </Fragment>
      ))}
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
      className={disabled ? 'share-arrow off' : 'share-arrow'}
      disabled={disabled}
      aria-label={direction === -1 ? 'Предыдущий месяц' : 'Следующий месяц'}
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

/** Строка записи: та же раскладка, что в ленте приложения, но без действий. */
function ShareEntryRow({ entry }: { entry: ShareEntry }) {
  const mood = entry.mood || 0
  const anxiety = entry.anxiety || 0

  return (
    <div className="share-entry">
      <div className={`share-mood m${mood}`}>{mood}</div>
      <div className="share-entry-body">
        <div className="share-entry-line">
          <span className="share-mood-label">{MOOD_LABELS[mood]}</span>
          {anxiety > 0 ? <span className={`share-anx a${anxiety}`}>{anxiety}</span> : null}
          <span className="share-time">{formatTime(entry.timestamp)}</span>
        </div>
        {entry.note ? <p className="share-note">{entry.note}</p> : null}
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
