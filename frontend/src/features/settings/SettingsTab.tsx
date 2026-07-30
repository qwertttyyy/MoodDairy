import { useSettings } from '../../shared/settings/SettingsProvider'
import { useConfirm } from '../../shared/ui/ConfirmProvider'
import { Toggle } from '../../shared/ui/Toggle'
import { useAuth } from '../auth/AuthProvider'
import { SharingSection } from '../sharing/SharingSection'

/** Ряд настройки: подпись слева, тумблер справа. */
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <span className="setting-label">{label}</span>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  )
}

/** Таб настроек: тема, прозрачность, вид графика, экспорт, доступ для врача, выход. */
export function SettingsTab() {
  const { settings, update } = useSettings()
  const confirm = useConfirm()
  const { logout } = useAuth()

  // Переход по ссылке, а не fetch: имя файла приходит в Content-Disposition сервера.
  const exportJson = () => {
    window.location.href = '/api/entries/export/'
  }

  const askLogout = () => {
    confirm({
      title: 'Выйти из аккаунта?',
      text: 'Зашифрованные ключи будут удалены.',
      confirmLabel: 'Выйти',
      icon: '🚪',
      onConfirm: () => {
        void logout()
      },
    })
  }

  return (
    <>
      <div className="settings-group liquid-glass">
        <ToggleRow
          label="Тёмная тема"
          checked={settings.darkMode}
          onChange={(darkMode) => update({ darkMode })}
        />
        <ToggleRow
          label="Уменьшить прозрачность"
          checked={settings.reduceTransparency}
          onChange={(reduceTransparency) => update({ reduceTransparency })}
        />
        <ToggleRow
          label="Плавный график"
          checked={settings.chartSmooth}
          onChange={(chartSmooth) => update({ chartSmooth })}
        />
      </div>

      <div className="settings-group liquid-glass">
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Экспорт данных</span>
          </div>
          <button className="btn-sm-accent" onClick={exportJson}>
            JSON
          </button>
        </div>
      </div>

      <div className="settings-group liquid-glass">
        <div
          className="setting-row"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}
        >
          <SharingSection />
        </div>
      </div>

      <div className="settings-group liquid-glass">
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Выйти из аккаунта</span>
          </div>
          <button className="btn-sm-danger" onClick={askLogout}>
            Выход
          </button>
        </div>
      </div>

      <p className="settings-footer">Moods v1.2</p>
    </>
  )
}
