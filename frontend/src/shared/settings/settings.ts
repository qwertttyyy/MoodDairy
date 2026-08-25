import { createContext, useContext } from 'react'

/** Ключ и поля совместимы с настройками существующих пользователей. */
export const SETTINGS_KEY = 'moods_settings'

export interface AppSettings {
  darkMode: boolean
  reduceTransparency: boolean
  chartSmooth: boolean
}

export interface SettingsContextValue {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => void
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings должен вызываться внутри SettingsProvider')
  return value
}
