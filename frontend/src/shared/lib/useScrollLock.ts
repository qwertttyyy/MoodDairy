import { useEffect } from 'react'

/**
 * Блокирует прокрутку body, пока открыта модалка.
 *
 * Счётчик нужен для вложенных модалок: памятка открывается поверх формы записи,
 * и её закрытие не должно разблокировать прокрутку под всё ещё открытой формой.
 */
let lockCount = 0
let previousOverflow = ''

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    lockCount++
    return () => {
      lockCount = Math.max(0, lockCount - 1)
      if (lockCount === 0) document.body.style.overflow = previousOverflow
    }
  }, [active])
}
