/** Стрелка навигации по периоду. Общая для помесячного и погодового выбора. */

interface ChartNavButtonProps {
  /** -1 — назад, 1 — вперёд. */
  direction: 1 | -1
  label: string
  disabled: boolean
  onClick: () => void
}

const PATH_BACK = 'M14.5 5.5 8 12l6.5 6.5'
const PATH_FORWARD = 'M9.5 5.5 16 12l-6.5 6.5'

export function ChartNavButton({ direction, label, disabled, onClick }: ChartNavButtonProps) {
  return (
    <button className="chart-nav-btn" aria-label={label} disabled={disabled} onClick={onClick}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={direction === -1 ? PATH_BACK : PATH_FORWARD} />
      </svg>
    </button>
  )
}
