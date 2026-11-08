import { useEffect, useState } from 'react'

import { localDateKey } from './dates'

/** Refresh calendar labels at midnight and after iOS resumes a suspended PWA. */
export function useLocalDay(): string {
  const [day, setDay] = useState(() => localDateKey(new Date()))
  useEffect(() => {
    let timer = 0
    const refresh = () => {
      window.clearTimeout(timer)
      const now = new Date()
      setDay(localDateKey(now))
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      timer = window.setTimeout(refresh, midnight.getTime() - now.getTime() + 50)
    }
    const resume = () => {
      if (document.visibilityState !== 'hidden') refresh()
    }
    refresh()
    window.addEventListener('pageshow', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pageshow', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])
  return day
}
