'use client'
import { useEffect, useRef, useState } from 'react'
import { browserClient } from './supabase'
import type { GameStatus, Hint, OptionSet, RoundStatus, WineAnswers } from './types'

export type PublicRoundState = {
  game_id: string
  wine_id: string | null
  label: string | null
  game_status: GameStatus
  round_status: RoundStatus
  round_no: number
  total_rounds: number
  ends_at: string | null
  options: OptionSet
  revealed_hints: Hint[]
  revealed_answers: WineAnswers | null
  reveal: {
    name?: string; country?: string | null; region?: string | null
    grape?: string | null; vintage?: number | null; abv?: number | null
    style?: string | null; image_url?: string | null
  } | null
}

export type PublicPlayer = { id: string; nickname: string; chips: number }

export type LiveGame = {
  state: PublicRoundState | null
  players: PublicPlayer[]
  connected: boolean
}

const POLL_MS = 3000

/**
 * Subscribes to the two anon-readable tables. If the socket does not reach
 * SUBSCRIBED — corporate wifi, a captive portal, a sleeping tab — we fall back
 * to polling /api/state, which also keeps hints ticking. The game never stalls
 * because of the transport.
 */
export function useLiveGame(gameId: string | null, playerId?: string | null): LiveGame {
  const [state, setState] = useState<PublicRoundState | null>(null)
  const [players, setPlayers] = useState<PublicPlayer[]>([])
  const [connected, setConnected] = useState(false)
  const connectedRef = useRef(false)

  useEffect(() => { connectedRef.current = connected }, [connected])

  // Initial load + polling fallback.
  useEffect(() => {
    if (!gameId) return
    let stopped = false

    async function load() {
      // This hook only ever reads json.state and json.players (the public
      // projection and the leaderboard), so it has no business asking for a
      // player's private slip — and no way to prove it is that player anyway.
      // Do not send playerId here; app/play/page.tsx fetches its own slip
      // separately, over an authenticated call.
      const qs = new URLSearchParams({ gameId: gameId! })
      const res = await fetch(`/api/state?${qs}`, { cache: 'no-store' })
      if (!res.ok || stopped) return
      const json = await res.json()
      setState(json.state)
      setPlayers(json.players ?? [])
    }

    void load()
    const timer = setInterval(() => {
      // Poll only while the socket is down; a healthy socket already pushes.
      if (!connectedRef.current) void load()
    }, POLL_MS)

    return () => { stopped = true; clearInterval(timer) }
    // playerId is accepted for the caller's own use (e.g. highlighting the
    // player's row) but intentionally not a dependency of this fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  // Realtime.
  useEffect(() => {
    if (!gameId) return
    const sb = browserClient()

    const channel = sb
      .channel(`casino:${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'casino', table: 'round_state', filter: `game_id=eq.${gameId}` },
        payload => setState(payload.new as PublicRoundState),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'casino', table: 'player', filter: `game_id=eq.${gameId}` },
        payload => {
          const row = payload.new as PublicPlayer & { game_id: string }
          setPlayers(prev => {
            const next = prev.filter(p => p.id !== row.id)
            next.push({ id: row.id, nickname: row.nickname, chips: row.chips })
            return next.sort((a, b) => b.chips - a.chips || a.nickname.localeCompare(b.nickname))
          })
        },
      )
      .subscribe(status => setConnected(status === 'SUBSCRIBED'))

    return () => { void sb.removeChannel(channel) }
  }, [gameId])

  return { state, players, connected }
}

/** Seconds remaining, recomputed locally. The wire only ever carries `ends_at`,
 *  so a laggy connection does not make the clock jump. */
export function useCountdown(endsAt: string | null): number {
  const [left, setLeft] = useState(0)

  useEffect(() => {
    if (!endsAt) { setLeft(0); return }
    const target = new Date(endsAt).getTime()
    const tick = () => setLeft(Math.max(0, Math.ceil((target - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [endsAt])

  return left
}
