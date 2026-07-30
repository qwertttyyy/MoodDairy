interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
}

/** Тумблер настроек. Разметка совпадает со старой (`.toggle` + `.toggle-track`). */
export function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" />
    </label>
  )
}
