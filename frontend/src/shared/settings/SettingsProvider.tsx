import { createContext, useCallback, useContext, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Настройки интерфейса. Ключ localStorage и имена полей менять нельзя:
 * у действующих пользователей уже сохранены темы и режим графика.
 */
export const SETTINGS_KEY = 'moods_settings'

export interface AppSettings {
  darkMode: boolean
  reduceTransparency: boolean
  chartSmooth: boolean
}

interface SettingsContextValue {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings должен вызываться внутри SettingsProvider')
  return value
}

function readStored(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
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

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => toSettings(readStored()))

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      // Мержим в уже сохранённый объект, чтобы не потерять незнакомые нам ключи.
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readStored(), ...patch }))
      return next
    })
  }, [])

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.darkMode ? 'dark' : 'light')
    document.documentElement.classList.toggle('reduce-transparency', settings.reduceTransparency)
  }, [settings.darkMode, settings.reduceTransparency])

  return (
    <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>
  )
}
