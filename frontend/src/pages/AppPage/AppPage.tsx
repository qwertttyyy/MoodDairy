import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

import { useAuth } from '../../features/auth/AuthContext'
import { AuthProvider } from '../../features/auth/AuthProvider'
import { AuthScreen } from '../../features/auth/AuthScreen'
import { StartupScreen } from '../../features/auth/StartupScreen'
import { useEntryModal } from '../../features/entries/EntryModalContext'
import { EntryModalProvider } from '../../features/entries/EntryModalProvider'
import { EntrySync, OfflineNotice } from '../../features/entries/EntrySync'
import { useGuide, useGuideActions } from '../../features/guide/GuideContext'
import { GuideProvider } from '../../features/guide/GuideProvider'
import { ConfirmProvider } from '../../shared/ui/ConfirmProvider'
import { SettingsProvider } from '../../shared/settings/SettingsProvider'
import { LoadingState } from '../../shared/ui/QueryState'
import { useOfflineState } from '../../shared/offline/offline'

import '../../shared/styles/shell.css'

const loadEntries = () => import('../../features/entries/EntriesTab')
const EntriesTab = lazy(loadEntries)
const loadEntryModal = () => import('../../features/entries/EntryModal')
const loadGuideModal = () => import('../../features/guide/MoodGuideModal')
const EntryModal = lazy(() => loadEntryModal().then((module) => ({ default: module.EntryModal })))
const MoodGuideModal = lazy(() =>
  loadGuideModal().then((module) => ({ default: module.MoodGuideModal })),
)
const ChartTab = lazy(() => import('../../features/chart/ChartTab'))
const SettingsTab = lazy(() => import('../../features/settings/SettingsTab'))

type TabName = 'home' | 'chart' | 'settings'

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

export default AppPage

function AppRoot() {
  const { status, retryBootstrap } = useAuth()
  useEffect(() => {
    // Код ленты загружается параллельно проверке сессии, без запроса личных данных.
    void loadEntries().catch(() => undefined)
  }, [])
  if (
    status === 'loading' ||
    status === 'offline' ||
    status === 'server-unavailable' ||
    status === 'invalid-config'
  ) {
    return <StartupScreen status={status} onRetry={retryBootstrap} />
  }
  if (status === 'anon') return <AuthScreen />
  return (
    <EntryModalProvider>
      <GuideProvider>
        <EntrySync />
        <AppShell />
        <DeferredDialogs />
      </GuideProvider>
    </EntryModalProvider>
  )
}

function AppShell() {
  const [tab, setTab] = useState<TabName>('home')
  const [visited, setVisited] = useState<ReadonlySet<TabName>>(() => new Set(['home']))
  const scrollPositions = useRef<Record<TabName, number>>({ home: 0, chart: 0, settings: 0 })

  useLayoutEffect(() => {
    window.scrollTo({ top: scrollPositions.current[tab], behavior: 'instant' })
  }, [tab])

  const selectTab = (next: TabName) => {
    if (next === tab) return
    scrollPositions.current[tab] = window.scrollY
    setTab(next)
    setVisited((previous) => {
      if (previous.has(next)) return previous
      const updated = new Set(previous)
      updated.add(next)
      return updated
    })
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        К содержимому
      </a>
      <main id="main-content" tabIndex={-1}>
        {visited.has('home') ? (
          <section className={tabClass(tab === 'home')} id="tab-home">
            <PageHeader title="Записи" withGuide />
            <Suspense fallback={<LoadingState label="Открываем записи…" />}>
              <EntriesTab active={tab === 'home'} />
            </Suspense>
          </section>
        ) : null}

        {visited.has('chart') ? (
          <section className={tabClass(tab === 'chart')} id="tab-chart">
            <PageHeader title="График" withGuide />
            <Suspense fallback={<LoadingState label="Открываем график…" />}>
              <ChartTab active={tab === 'chart'} />
            </Suspense>
          </section>
        ) : null}

        {visited.has('settings') ? (
          <section className={tabClass(tab === 'settings')} id="tab-settings">
            <PageHeader title="Настройки" />
            <Suspense fallback={<LoadingState label="Открываем настройки…" />}>
              <SettingsTab active={tab === 'settings'} />
            </Suspense>
          </section>
        ) : null}
      </main>

      <div className="tab-dock">
        <TabBar tab={tab} visited={visited} onChange={selectTab} />
        <AddEntryButton />
      </div>
    </div>
  )
}

function AddEntryButton() {
  const entryModal = useEntryModal()
  const { writeBlocked } = useOfflineState()
  return (
    <button
      type="button"
      className={entryModal.isOpen ? 'fab-add is-hidden' : 'fab-add'}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        entryModal.open(null, event.currentTarget.getBoundingClientRect())
      }}
      aria-label="Добавить запись"
      disabled={writeBlocked}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 5.4v13.2M5.4 12h13.2" />
      </svg>
    </button>
  )
}

function DeferredDialogs() {
  const { isOpen: entryOpen } = useEntryModal()
  const { isOpen: guideOpen } = useGuide()
  const [loaded, setLoaded] = useState({ entry: entryOpen, guide: guideOpen })
  useEffect(() => {
    if (entryOpen || guideOpen) {
      setLoaded((previous) => ({
        entry: previous.entry || entryOpen,
        guide: previous.guide || guideOpen,
      }))
    }
  }, [entryOpen, guideOpen])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEntryModal().catch(() => undefined)
      void loadGuideModal().catch(() => undefined)
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <Suspense
      fallback={
        <p className="dialog-loading" role="status">
          Открываем окно…
        </p>
      }
    >
      {(entryOpen || loaded.entry) && <EntryModal />}
      {(guideOpen || loaded.guide) && <MoodGuideModal />}
    </Suspense>
  )
}

/** Заголовок экрана с памяткой, которая уезжает вместе с верхней панелью. */
function PageHeader({ title, withGuide = false }: { title: string; withGuide?: boolean }) {
  const { open } = useGuideActions()
  return (
    <>
      <header className="page-header">
        <h1 className="large-title">{title}</h1>
        {withGuide && (
          <button
            type="button"
            className="btn-icon-glass page-info"
            onClick={() => open('mood')}
            aria-label="Шкала настроения"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v6" />
              <circle cx="12" cy="7.5" r="1.05" fill="currentColor" stroke="none" />
            </svg>
          </button>
        )}
      </header>
      <OfflineNotice />
    </>
  )
}

function tabClass(active: boolean): string {
  return active ? 'tab-content' : 'tab-content hidden'
}

interface TabBarProps {
  tab: TabName
  visited: ReadonlySet<TabName>
  onChange: (tab: TabName) => void
}

const TABS: ReadonlyArray<{ name: TabName; label: string; icon: ReactNode }> = [
  {
    name: 'home',
    label: 'Записи',
    icon: (
      <>
        <path d="M3.6 10.6 12 3.9l8.4 6.7" />
        <path d="M5.9 9.6V19a1.2 1.2 0 0 0 1.2 1.2h9.8A1.2 1.2 0 0 0 18.1 19V9.6" />
      </>
    ),
  },
  {
    name: 'chart',
    label: 'График',
    icon: <path d="M2.8 12.4h3.6l2.1-6.2 3.5 12.1 2.3-7 1.5 3.1h5.4" />,
  },
  {
    name: 'settings',
    label: 'Настройки',
    icon: (
      <>
        <circle cx="12" cy="12" r="3.1" />
        <path d="M12 2.9v2.3M12 18.8v2.3M21.1 12h-2.3M5.2 12H2.9M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6" />
      </>
    ),
  },
]

/** Плавающая капсула вкладок. Активная подсвечена своей плашкой. */
function TabBar({ tab, visited, onChange }: TabBarProps) {
  return (
    <nav className="tab-bar liquid-glass" aria-label="Основная навигация">
      {TABS.map((item) => (
        <button
          type="button"
          key={item.name}
          className={item.name === tab ? 'tab-btn active' : 'tab-btn'}
          onClick={() => onChange(item.name)}
          aria-label={item.label}
          aria-current={item.name === tab ? 'page' : undefined}
          aria-controls={visited.has(item.name) ? `tab-${item.name}` : undefined}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {item.icon}
          </svg>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
