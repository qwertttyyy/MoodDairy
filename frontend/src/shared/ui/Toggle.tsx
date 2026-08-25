interface ToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

/** Тумблер настроек. Разметка совпадает со старой (`.toggle` + `.toggle-track`). */
export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <span className="toggle">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
    </span>
  )
}
