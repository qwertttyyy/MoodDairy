import { useEffect, useState } from 'react'

import { useOfflineState } from './offline'

const PENDING_NOTICE_DELAY_MS = 1000

/** Keep fast background saves quiet; offline state and errors need immediate feedback. */
export function useSyncFeedback() {
  const state = useOfflineState()
  const hasPending = state.pending > 0
  const [delayElapsed, setDelayElapsed] = useState(false)

  useEffect(() => {
    if (!hasPending) {
      setDelayElapsed(false)
      return
    }
    const timer = window.setTimeout(() => setDelayElapsed(true), PENDING_NOTICE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [hasPending])

  return {
    ...state,
    showPending: hasPending && (!state.connected || Boolean(state.error) || delayElapsed),
  }
}
