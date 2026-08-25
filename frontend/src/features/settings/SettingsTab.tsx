import { useSettings } from '../../shared/settings/settings'
import { useConfirm } from '../../shared/ui/confirm'
import { Toggle } from '../../shared/ui/Toggle'
import { useAuth } from '../auth/AuthContext'
import { TagsSection } from '../entries/TagsSection'
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
    <label className="set-row set-row-toggle">
      <span className="set-label">{label}</span>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </label>
  )
}

/** Таб настроек: вид, теги, доступ для врача, выход. */
export function SettingsTab() {
  const { settings, update } = useSettings()
  const confirm = useConfirm()
  const { logout } = useAuth()

  const askLogout = () => {
    confirm({
      title: 'Выйти из аккаунта?',
      text: 'Зашифрованные ключи будут удалены.',
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
          checked={settings.reduceTransparency}
          onChange={(reduceTransparency) => update({ reduceTransparency })}
        />
        <div className="set-sep" />
        <ToggleRow
          label="Плавный график"
          checked={settings.chartSmooth}
          onChange={(chartSmooth) => update({ chartSmooth })}
        />
      </div>

      <h2 className="settings-title">Теги</h2>
      <TagsSection />

      <h2 className="settings-title">Доступ для врача</h2>
      <SharingSection />

      <h2 className="settings-title">Аккаунт</h2>
      <div className="settings-group">
        <div className="set-row">
          <span className="set-label">Выйти из аккаунта</span>
          <button type="button" className="btn-plain btn-plain-danger" onClick={askLogout}>
            Выход
          </button>
        </div>
      </div>

      <p className="settings-footer">Moods v1.2</p>
    </>
  )
}
