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
    <div className="set-row">
      <span className="set-label">{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
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
      onConfirm: () => {
        void logout()
      },
    })
  }

  return (
    <>
      <h3 className="settings-title">Вид</h3>
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

      <h3 className="settings-title">Теги</h3>
      <TagsSection />

      <h3 className="settings-title">Доступ для врача</h3>
      <SharingSection />

      <h3 className="settings-title">Аккаунт</h3>
      <div className="settings-group">
        <div className="set-row">
          <span className="set-label">Выйти из аккаунта</span>
          <button className="btn-plain btn-plain-danger" onClick={askLogout}>
            Выход
          </button>
        </div>
      </div>

      <p className="settings-footer">Moods v1.2</p>
    </>
  )
}
