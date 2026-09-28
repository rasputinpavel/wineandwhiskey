'use client'
import type { Lang } from './types'

// The guest's whole identity lives in localStorage. A refresh, a locked screen
// or a dead battery swapped for a charger all resume the same seat.
const KEY = 'wc:session'

export type Session = {
  gameId: string
  playerId: string
  playerToken: string
  nickname: string
  lang: Lang
}

export function loadSession(): Session | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

/**
 * Returns false when the write failed, or -- iOS Safari's "Block All
 * Cookies", some locked-down work profiles, some private modes -- when it
 * silently accepted the write but never actually persisted it. The caller
 * must not navigate to /play on a false: there would be no session to load
 * there, and the guest would bounce straight back to the join screen with no
 * explanation.
 */
export function saveSession(s: Session): boolean {
  try {
    const payload = JSON.stringify(s)
    window.localStorage.setItem(KEY, payload)
    return window.localStorage.getItem(KEY) === payload
  } catch {
    return false
  }
}

export function clearSession(): void {
  try { window.localStorage.removeItem(KEY) } catch { /* private mode */ }
}
