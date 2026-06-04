'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'

// Reset the kiosk to the home screen after `timeoutSec` of no touch. Skips the
// reset when we're already on `/`.
export function IdleReset({ timeoutSec }: { timeoutSec: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const reset = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        if (pathname !== '/') router.push('/')
      }, timeoutSec * 1000)
    }
    reset()
    const events: (keyof WindowEventMap)[] = ['touchstart', 'mousedown', 'keydown']
    events.forEach(e => window.addEventListener(e, reset))
    return () => {
      events.forEach(e => window.removeEventListener(e, reset))
      if (timer.current) clearTimeout(timer.current)
    }
  }, [pathname, router, timeoutSec])

  return null
}
