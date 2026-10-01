'use client'
import { useEffect, useState } from 'react'

/**
 * True when the guest's OS/browser asks for reduced motion. Checked once on
 * mount and kept live (some phones let you flip this from a quick-settings
 * tile mid-session). Every animated bit of UI gates on this one hook instead
 * of re-deriving its own media query, so "skip the motion, show the end
 * state" means the same thing everywhere.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  return reduced
}
