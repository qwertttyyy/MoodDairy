/**
 * Контурные знаки для пустых состояний — вместо эмодзи.
 *
 * Эмодзи здесь были единственным местом, где интерфейс зависел от системного
 * шрифта картинок: на разных платформах он рисует их по-своему и не следует
 * ни теме, ни размеру текста.
 */

const COMMON = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** Лист с записями — пустая лента. */
export function NotesIcon() {
  return (
    <svg {...COMMON} aria-hidden="true">
      <path d="M6 3.6h9.2L19.2 7.6V20.4H6z" />
      <path d="M15 3.8v4h4" />
      <path d="M9 12.4h7M9 16.2h4.6" />
    </svg>
  )
}

/** Кривая на осях — пустой график. */
export function ChartIcon() {
  return (
    <svg {...COMMON} aria-hidden="true">
      <path d="M4 4v16h16" />
      <path d="M7.4 15.6l3.4-4.4 2.9 2.4 4.3-6" />
    </svg>
  )
}

/** Замок — ссылка врача недоступна. */
export function LockIcon() {
  return (
    <svg {...COMMON} aria-hidden="true">
      <rect x="4.8" y="10.4" width="14.4" height="9.8" rx="2.4" />
      <path d="M8.4 10.2V7.8a3.6 3.6 0 0 1 7.2 0v2.4" />
    </svg>
  )
}
