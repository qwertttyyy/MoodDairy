import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { SETTINGS_KEY, SettingsContext } from './settings'
import type { AppSettings } from './settings'

/**
 * Настройки интерфейса. Ключ localStorage и имена полей менять нельзя:
 * у действующих пользователей уже сохранены темы и режим графика.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStored(raw: string | null): Record<string, unknown> {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function readStored(): Record<string, unknown> {
  try {
    return parseStored(localStorage.getItem(SETTINGS_KEY))
  } catch {
    return {}
  }
}

function toSettings(stored: Record<string, unknown>): AppSettings {
  return {
    darkMode: stored.darkMode === true,
    reduceTransparency: stored.reduceTransparency === true,
    // Плавный график включён по умолчанию — выключен только при явном false.
    chartSmooth: stored.chartSmooth !== false,
  }
}

interface SettingsState {
  settings: AppSettings
  stored: Record<string, unknown>
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SettingsState>(() => {
    const stored = readStored()
    return { settings: toSettings(stored), stored }
  })
  const { settings } = state

  const update = useCallback((patch: Partial<AppSettings>) => {
    setState((previous) => ({
      ...previous,
      settings: { ...previous.settings, ...patch },
    }))
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...state.stored, ...settings }))
    } catch {
      // Настройка продолжает действовать в текущей вкладке, даже если хранилище недоступно.
    }
  }, [settings, state.stored])

  useEffect(() => {
    const syncFromAnotherTab = (event: StorageEvent) => {
      if (event.key !== SETTINGS_KEY) return
      const stored = parseStored(event.newValue)
      setState({ settings: toSettings(stored), stored })
    }
    window.addEventListener('storage', syncFromAnotherTab)
    return () => window.removeEventListener('storage', syncFromAnotherTab)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.darkMode ? 'dark' : 'light')
    document.documentElement.classList.toggle('reduce-transparency', settings.reduceTransparency)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', settings.darkMode ? '#000000' : '#f2f2f7')
  }, [settings.darkMode, settings.reduceTransparency])

  return (
    <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>
  )
}
