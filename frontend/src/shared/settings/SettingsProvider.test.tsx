import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { SETTINGS_KEY, useSettings } from './settings'
import { SettingsProvider } from './SettingsProvider'

function SettingsProbe() {
  const { settings, update } = useSettings()
  return (
    <>
      <output>{`${settings.darkMode}:${settings.reduceTransparency}:${settings.chartSmooth}`}</output>
      <button type="button" onClick={() => update({ chartSmooth: false })}>
        Выключить сглаживание
      </button>
    </>
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.setAttribute('data-theme', 'light')
  document.documentElement.classList.remove('reduce-transparency')
  document.head.innerHTML = '<meta name="theme-color" content="#f2f2f7">'
})

describe('SettingsProvider', () => {
  it('сохраняет неизвестные поля и пишет localStorage вне state updater', async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ darkMode: true, chartSmooth: true, futureSetting: 'keep-me' }),
    )
    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    )

    expect(screen.getByText('true:false:true')).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#000000')

    await userEvent.click(screen.getByRole('button', { name: 'Выключить сглаживание' }))
    await waitFor(() => {
      const stored: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')
      expect(stored).toMatchObject({ chartSmooth: false, futureSetting: 'keep-me' })
    })
  })

  it('применяет storage event из другой вкладки', async () => {
    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    )

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: SETTINGS_KEY,
        newValue: JSON.stringify({
          darkMode: true,
          reduceTransparency: true,
          chartSmooth: false,
        }),
      }),
    )

    await waitFor(() => expect(screen.getByText('true:true:false')).toBeInTheDocument())
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveClass('reduce-transparency')
  })
})
