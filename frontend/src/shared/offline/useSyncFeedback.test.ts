import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setOfflineState } from './offline'
import { useSyncFeedback } from './useSyncFeedback'

beforeEach(() => {
  vi.useFakeTimers()
  setOfflineState({
    connected: true,
    syncing: false,
    pending: 0,
    error: '',
    storageError: false,
    writeBlocked: false,
  })
})

afterEach(() => vi.useRealTimers())

describe('обратная связь при фоновой отправке', () => {
  it('не показывает статус для быстрой отправки', () => {
    const { result } = renderHook(useSyncFeedback)
    act(() => setOfflineState({ pending: 1, syncing: true }))
    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(result.current.showPending).toBe(false)
    act(() => setOfflineState({ pending: 0, syncing: false }))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.showPending).toBe(false)
  })

  it('показывает длительную отправку, не откладывая её при изменении размера очереди', () => {
    const { result } = renderHook(useSyncFeedback)
    act(() => setOfflineState({ pending: 2, syncing: true }))
    act(() => {
      vi.advanceTimersByTime(900)
    })
    act(() => setOfflineState({ pending: 1 }))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current.showPending).toBe(true)
    act(() => setOfflineState({ pending: 0, syncing: false }))
    expect(result.current.showPending).toBe(false)
  })

  it('сразу сообщает об отсутствии связи и об ошибке при доступной сети', () => {
    const { result } = renderHook(useSyncFeedback)
    act(() => setOfflineState({ pending: 1, connected: false }))
    expect(result.current.showPending).toBe(true)
    act(() => setOfflineState({ connected: true, error: 'Сервер недоступен' }))
    expect(result.current.showPending).toBe(true)
  })

  it('после завершения долгой отправки снова скрывает статус следующей быстрой', () => {
    const { result } = renderHook(useSyncFeedback)
    act(() => setOfflineState({ pending: 1 }))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.showPending).toBe(true)
    act(() => setOfflineState({ pending: 0 }))
    act(() => setOfflineState({ pending: 1 }))
    expect(result.current.showPending).toBe(false)
  })
})
