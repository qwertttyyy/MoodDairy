import { usePwa } from '../../shared/pwa/pwa'
import { useToast } from '../../shared/ui/toast'

export function InstallSection() {
  const { canInstall, installPending, isIos, isStandalone, promptInstall } = usePwa()
  const showToast = useToast()

  if (isStandalone) return null

  if (canInstall) {
    const install = async () => {
      const result = await promptInstall()
      if (result === 'accepted') showToast('Установка Moods началась')
      if (result === 'unavailable') showToast('Установка сейчас недоступна', true)
    }

    return (
      <>
        <h2 className="settings-title">Приложение</h2>
        <div className="settings-group">
          <div className="set-row">
            <span className="set-label">Установить Moods</span>
            <button
              type="button"
              className="btn-plain"
              onClick={install}
              disabled={installPending}
              aria-busy={installPending}
            >
              {installPending ? 'Открываем…' : 'Установить'}
            </button>
          </div>
        </div>
      </>
    )
  }

  if (isIos) {
    return (
      <>
        <h2 className="settings-title">Приложение</h2>
        <div className="settings-group">
          <div className="set-row install-instruction">
            <span className="set-label">Чтобы установить Moods:</span>
            <span className="set-hint">Поделиться → На экран Домой</span>
          </div>
        </div>
      </>
    )
  }

  return null
}
