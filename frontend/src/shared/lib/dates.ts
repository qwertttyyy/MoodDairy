/** Форматирование дат. Порт утилит из backend/static/app.js и share.js. */

/** «Сегодня» / «Вчера» / «5 марта» / «5 марта 2025 г.» — для ленты записей.
 *
 * Год печатается только у дат прошлых лет: в ленте текущего года он повторялся
 * бы в каждом заголовке, ничего при этом не различая.
 */
export function dayLabel(dateStr: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(`${dateStr}T12:00:00`)
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  const sameYear = d.getFullYear() === today.getFullYear()
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** Полная дата без «Сегодня»/«Вчера» — для страницы врача. */
export function dayLabelPlain(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/** Локальная дата в формате YYYY-MM-DD (для <input type="date">). */
export function isoDateStr(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** Локальное время в формате HH:MM (для <input type="time">). */
export function isoTimeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
