import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

import { useAuth } from '../../features/auth/AuthContext'
import { AuthProvider } from '../../features/auth/AuthProvider'
import { AuthScreen } from '../../features/auth/AuthScreen'
import { ChartTab } from '../../features/chart/ChartTab'
import { EntriesTab } from '../../features/entries/EntriesTab'
import { EntryModal } from '../../features/entries/EntryModal'
import { useEntryModal } from '../../features/entries/EntryModalContext'
import { EntryModalProvider } from '../../features/entries/EntryModalProvider'
import { useGuide } from '../../features/guide/GuideContext'
import { GuideProvider } from '../../features/guide/GuideProvider'
import { MoodGuideModal } from '../../features/guide/MoodGuideModal'
import { SettingsTab } from '../../features/settings/SettingsTab'
import { ConfirmProvider } from '../../shared/ui/ConfirmProvider'
import { SettingsProvider } from '../../shared/settings/SettingsProvider'

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
      {/* Табы остаются в DOM и скрываются классом — как в старом фронте:
          так лента не теряет прокрутку при переключении. */}
      <main className={tabClass(tab === 'home')} id="tab-home">
        <PageHeader title="Записи" onOpenGuide={() => guide.open('mood')} />
        <EntriesTab />
      </main>

      <section className={tabClass(tab === 'chart')} id="tab-chart">
        <PageHeader title="График" onOpenGuide={() => guide.open('mood')} />
        <ChartTab active={tab === 'chart'} />
      </section>

      <section className={tabClass(tab === 'settings')} id="tab-settings">
        <PageHeader title="Настройки" />
        <SettingsTab />
      </section>

      <div className="tab-dock">
        <TabBar tab={tab} onChange={setTab} />
        <button
          className={entryModal.isOpen ? 'fab-add is-hidden' : 'fab-add'}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            entryModal.open(null, event.currentTarget.getBoundingClientRect())
          }}
          aria-label="Добавить запись"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          >
            <path d="M12 5.4v13.2M5.4 12h13.2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/** Заголовок экрана с памяткой, которая уезжает вместе с верхней панелью. */
function PageHeader({ title, onOpenGuide }: { title: string; onOpenGuide?: () => void }) {
  return (
    <header className="page-header">
      <h2 className="large-title">{title}</h2>
      {onOpenGuide && (
        <button
          className="btn-icon-glass page-info"
          onClick={onOpenGuide}
          aria-label="Шкала настроения"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6" />
            <circle cx="12" cy="7.5" r="1.05" fill="currentColor" stroke="none" />
          </svg>
        </button>
      )}
    </header>
  )
}

function tabClass(active: boolean): string {
  return active ? 'tab-content' : 'tab-content hidden'
}

interface TabBarProps {
  tab: TabName
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
function TabBar({ tab, onChange }: TabBarProps) {
  return (
    <nav className="tab-bar liquid-glass">
      {TABS.map((item) => (
        <button
          key={item.name}
          className={item.name === tab ? 'tab-btn active' : 'tab-btn'}
          onClick={() => onChange(item.name)}
          aria-label={item.label}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {item.icon}
          </svg>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
