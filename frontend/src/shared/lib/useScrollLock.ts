import { useEffect } from 'react'

/**
 * Блокирует прокрутку body, пока открыта модалка.
 *
 * Счётчик нужен для вложенных модалок: памятка открывается поверх формы записи,
 * и её закрытие не должно разблокировать прокрутку под всё ещё открытой формой.
 */
let lockCount = 0

function applyLock(): void {
  const locked = lockCount > 0
  document.body.style.overflow = locked ? 'hidden' : ''
  document.body.style.touchAction = locked ? 'none' : ''
}

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    lockCount++
    applyLock()
    return () => {
      lockCount--
      applyLock()
    }
  }, [active])
}
