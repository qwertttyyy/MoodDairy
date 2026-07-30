import { useCallback, useEffect, useRef, useState } from 'react'

import { AuthProvider, useAuth } from '../../features/auth/AuthProvider'
import { AuthScreen } from '../../features/auth/AuthScreen'
import { ChartTab } from '../../features/chart/ChartTab'
import { EntriesTab } from '../../features/entries/EntriesTab'
import { EntryModal } from '../../features/entries/EntryModal'
import { EntryModalProvider, useEntryModal } from '../../features/entries/EntryModalContext'
import { GuideProvider, useGuide } from '../../features/guide/GuideContext'
import { MoodGuideModal } from '../../features/guide/MoodGuideModal'
import { SettingsTab } from '../../features/settings/SettingsTab'
import { ConfirmProvider } from '../../shared/ui/ConfirmProvider'
import { SettingsProvider } from '../../shared/settings/SettingsProvider'

type TabName = 'home' | 'chart' | 'settings'

const TAB_TITLES: Record<TabName, string> = {
  home: 'Moods',
  chart: 'График',
  settings: 'Настройки',
}

const RESIZE_DEBOUNCE_MS = 150

/** Главная страница: экран входа либо оболочка приложения с тремя табами. */
export function AppPage() {
  return (
    <SettingsProvider>
      <ConfirmProvider>
        <AuthProvider>
          <AppRoot />
        </AuthProvider>
      </ConfirmProvider>
    </SettingsProvider>
  )
}

function AppRoot() {
  const { status } = useAuth()
  if (status === 'loading') return null
  if (status === 'anon') return <AuthScreen />
  return (
    <EntryModalProvider>
      <GuideProvider>
        <AppShell />
        <EntryModal />
        <MoodGuideModal />
      </GuideProvider>
    </EntryModalProvider>
  )
}

function AppShell() {
  const [tab, setTab] = useState<TabName>('home')
  const entryModal = useEntryModal()
  const guide = useGuide()

  return (
    <div className="app-shell">
      <header className="app-header liquid-glass">
        <h1 className="app-title">{TAB_TITLES[tab]}</h1>
        <div className="header-actions">
          {tab === 'home' && (
            <>
              <button
                className="btn-icon-glass"
                onClick={() => guide.open('mood')}
                aria-label="Шкала настроения"
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
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
              </button>
              <button
                className="btn-icon-glass"
                onClick={() => entryModal.open()}
                aria-label="Добавить запись"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Табы остаются в DOM и скрываются классом — как в старом фронте:
          так лента не теряет прокрутку при переключении. */}
      <main className={tabClass(tab === 'home')} id="tab-home">
        <EntriesTab />
      </main>

      <section className={tabClass(tab === 'chart')} id="tab-chart">
        <ChartTab active={tab === 'chart'} />
      </section>

      <section className={tabClass(tab === 'settings')} id="tab-settings">
        <SettingsTab />
      </section>

      <TabBar tab={tab} onChange={setTab} />
    </div>
  )
}

function tabClass(active: boolean): string {
  return active ? 'tab-content' : 'tab-content hidden'
}

interface TabBarProps {
  tab: TabName
  onChange: (tab: TabName) => void
}

/** Таб-бар с бегающим индикатором: позиция считается по активной кнопке. */
function TabBar({ tab, onChange }: TabBarProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)

  const updateIndicator = useCallback(() => {
    const active = barRef.current?.querySelector<HTMLElement>('.tab-btn.active')
    const indicator = indicatorRef.current
    if (!active || !indicator) return
    indicator.style.width = `${active.offsetWidth}px`
    indicator.style.transform = `translateX(${active.offsetLeft}px)`
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(updateIndicator)
    return () => cancelAnimationFrame(frame)
  }, [tab, updateIndicator])

  useEffect(() => {
    let timer = 0
    const onResize = () => {
      clearTimeout(timer)
      timer = window.setTimeout(updateIndicator, RESIZE_DEBOUNCE_MS)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [updateIndicator])

  return (
    <nav className="tab-bar-wrap">
      <div className="tab-bar liquid-glass" ref={barRef}>
        <div className="tab-indicator" ref={indicatorRef} />
        <button
          className={tab === 'home' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => onChange('home')}
          aria-label="Записи"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span>Записи</span>
        </button>
        <button
          className={tab === 'chart' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => onChange('chart')}
          aria-label="График"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span>График</span>
        </button>
        <button
          className={tab === 'settings' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => onChange('settings')}
          aria-label="Настройки"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
          <span>Настройки</span>
        </button>
      </div>
    </nav>
  )
}
