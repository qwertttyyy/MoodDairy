import { useSettings } from '../../shared/settings/settings'
import { useConfirm } from '../../shared/ui/confirm'
import { Toggle } from '../../shared/ui/Toggle'
import { useOfflineState } from '../../shared/offline/offline'
import { useAuth } from '../auth/AuthContext'
import { TagsSection } from '../entries/TagsSection'
import { SharingSection } from '../sharing/SharingSection'
import { InstallSection } from './InstallSection'

import './settings.css'

/** Ряд настройки: подпись слева, тумблер справа. */
function ToggleRow({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="set-row set-row-toggle">
      <span className="set-label">{label}</span>
      <Toggle label={label} checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  )
}

/** Таб настроек: вид, теги, доступ для врача, выход. */
export function SettingsTab({ active = true }: { active?: boolean }) {
  const { settings, systemReduceTransparency, update } = useSettings()
  const confirm = useConfirm()
  const { logout } = useAuth()
  const { pending } = useOfflineState()

  const askLogout = () => {
    confirm({
      title: 'Выйти из аккаунта?',
      text:
        pending > 0
          ? `На устройстве остались неотправленные записи: ${pending}. При выходе они и локальный кеш будут удалены. Сначала подключитесь к интернету, чтобы сохранить их на сервере.`
          : 'Локальные записи, кеш и ключи будут удалены с устройства.',
      confirmLabel: 'Выйти',
      onConfirm: logout,
    })
  }

  return (
    <>
      <h2 className="settings-title">Вид</h2>
      <div className="settings-group">
        <ToggleRow
          label="Тёмная тема"
          checked={settings.darkMode}
          onChange={(darkMode) => update({ darkMode })}
        />
        <div className="set-sep" />
        <ToggleRow
          label="Уменьшить прозрачность"
          checked={settings.reduceTransparency || systemReduceTransparency}
          disabled={systemReduceTransparency}
          onChange={(reduceTransparency) => update({ reduceTransparency })}
        />
        <div className="set-sep" />
        <ToggleRow
          label="Плавный график"
          checked={settings.chartSmooth}
          onChange={(chartSmooth) => update({ chartSmooth })}
        />
      </div>
      {systemReduceTransparency && (
        <p className="settings-note">Уменьшение прозрачности включено в настройках устройства.</p>
      )}

      <h2 className="settings-title">Теги</h2>
      <TagsSection active={active} />

      <h2 className="settings-title">Доступ для врача</h2>
      <SharingSection active={active} />

      <InstallSection />

      <h2 className="settings-title">Аккаунт</h2>
      <div className="settings-group">
        <div className="set-row">
          <span className="set-label">Выйти из аккаунта</span>
          <button type="button" className="btn-plain btn-plain-danger" onClick={askLogout}>
            Выход
          </button>
        </div>
      </div>

      <p className="settings-footer">
        Moods v{__APP_VERSION__} · сборка {__BUILD_SHA__}
      </p>
    </>
  )
}

export default SettingsTab
