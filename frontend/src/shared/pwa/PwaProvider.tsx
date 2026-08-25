import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

import { PwaContext } from './pwa'
import type { InstallResult } from './pwa'

import './pwa.css'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean
}

function standaloneMode(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as NavigatorWithStandalone).standalone)
  )
}

function iosDevice(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installPending, setInstallPending] = useState(false)
  const [isStandalone, setIsStandalone] = useState(standaloneMode)
  const [updatePending, setUpdatePending] = useState(false)
  const [updateFailed, setUpdateFailed] = useState(false)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)')
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    const handleInstalled = () => {
      setInstallEvent(null)
      setIsStandalone(true)
    }
    const handleDisplayMode = () => setIsStandalone(standaloneMode())

    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    displayMode.addEventListener('change', handleDisplayMode)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      displayMode.removeEventListener('change', handleDisplayMode)
    }
  }, [])

  const promptInstall = useCallback(async (): Promise<InstallResult> => {
    if (!installEvent || isStandalone) return 'unavailable'
    setInstallPending(true)
    try {
      await installEvent.prompt()
      const choice = await installEvent.userChoice
      setInstallEvent(null)
      return choice.outcome
    } catch {
      return 'unavailable'
    } finally {
      setInstallPending(false)
    }
  }, [installEvent, isStandalone])

  const value = useMemo(
    () => ({
      canInstall: installEvent !== null && !isStandalone,
      isIos: iosDevice(),
      isStandalone,
      installPending,
      promptInstall,
    }),
    [installEvent, installPending, isStandalone, promptInstall],
  )

  const applyUpdate = async () => {
    setUpdatePending(true)
    setUpdateFailed(false)
    try {
      await updateServiceWorker(true)
      setUpdatePending(false)
    } catch {
      setUpdateFailed(true)
      setUpdatePending(false)
    }
  }

  return (
    <PwaContext.Provider value={value}>
      {children}
      {needRefresh ? (
        <aside className="pwa-update" role="status" aria-live="polite" aria-busy={updatePending}>
          <span>{updateFailed ? 'Не удалось обновить приложение' : 'Доступна новая версия'}</span>
          <button
            type="button"
            className="pwa-update-action"
            onClick={applyUpdate}
            disabled={updatePending}
          >
            {updatePending ? 'Обновляем…' : updateFailed ? 'Повторить' : 'Обновить'}
          </button>
          <button
            type="button"
            className="pwa-update-later"
            onClick={() => setNeedRefresh(false)}
            disabled={updatePending}
          >
            Позже
          </button>
        </aside>
      ) : null}
    </PwaContext.Provider>
  )
}
