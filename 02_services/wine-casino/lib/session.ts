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

export function saveSession(s: Session): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ }
}

export function clearSession(): void {
  try { window.localStorage.removeItem(KEY) } catch { /* private mode */ }
}
