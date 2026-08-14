import { MAX_MOOD } from '../../shared/constants'

/**
 * Класс цвета настроения для шкалы 1–9.
 *
 * Цвет задаётся именно классом: тона отличаются между светлой и тёмной темой,
 * инлайновый style этого бы не смог. Оценка вне шкалы (не расшифровалась)
 * остаётся без цвета.
 */
export function moodClass(mood: number): string {
  return mood >= 1 && mood <= MAX_MOOD ? `m${mood}` : ''
}
