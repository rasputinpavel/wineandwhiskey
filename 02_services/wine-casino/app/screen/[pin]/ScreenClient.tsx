'use client'
import { useEffect, useState } from 'react'
import { HintFeed } from '@/components/HintFeed'
import { Leaderboard } from '@/components/Leaderboard'
import { QrPanel } from '@/components/QrPanel'
import { Timer } from '@/components/Timer'
import { useLiveGame } from '@/lib/realtime'
import { pick } from '@/lib/i18n'
import type { CategoryDef } from '@/lib/types'

export function ScreenClient({
  gameId, pin, title, categories,
}: { gameId: string; pin: string; title: string; categories: CategoryDef[] }) {
  const { state, players } = useLiveGame(gameId)
  const status = state?.round_status ?? 'pending'
  const gameStatus = state?.game_status ?? 'lobby'
  // round_status stays 'pending' both before the first wine and between every
  // pair of wines (see lib/round.ts's nextWine/publish), so it alone cannot
  // tell "nobody has played yet" from "everyone wants the standings". Only
  // the former should still be showing the join QR.
  const beforeFirstWine = gameStatus === 'lobby' && (state?.round_no ?? 0) === 0

  // Where guests actually type. The screen knows its own address, so this is
  // right even when NEXT_PUBLIC_CASINO_URL was never set.
  const [joinHost, setJoinHost] = useState('')
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_CASINO_URL || window.location.origin
    setJoinHost(base.replace(/^https?:\/\//, '').replace(/\/$/, ''))
  }, [])

  return (
    <main className="min-h-screen bg-felt p-10 pb-28">
      <header className="mb-8 flex items-start justify-between">
        <h1 className="font-display text-6xl tracking-display text-amber-gold">{title}</h1>
        {state?.wine_id && (
          <div className="text-right">
            <div className="text-sm uppercase tracking-overline text-pale-stone">
              {state.label} · {state.round_no}/{state.total_rounds}
            </div>
            {status === 'betting' && <Timer endsAt={state.ends_at} size="xl" />}
          </div>
        )}
      </header>

      {/* Lobby: the join panel is the whole screen, because that is the only
          thing anyone needs to do right now. */}
      {gameStatus !== 'finished' && status === 'pending' && beforeFirstWine && (
        <div className="grid grid-cols-2 gap-12">
          <QrPanel pin={pin} />
          <div>
            <h2 className="mb-4 font-heading text-2xl text-warm-white">
              At the table · {players.length}
            </h2>
            <Leaderboard players={players} max={20} />
          </div>
        </div>
      )}

      {/* Between wines: everyone at the table wants to see who is winning,
          not the join QR again. Keep the PIN visible, small, for latecomers. */}
      {gameStatus !== 'finished' && status === 'pending' && !beforeFirstWine && (
        <div className="mx-auto max-w-2xl space-y-6 text-center">
          <div className="text-sm uppercase tracking-overline text-pale-stone">
            PIN {pin} · Up next: wine {state?.round_no ?? 0}/{state?.total_rounds ?? 0}
          </div>
          <h2 className="font-display text-5xl text-amber-gold">Standings</h2>
          <Leaderboard players={players} max={20} />
        </div>
      )}

      {status === 'betting' && (
        <div className="grid grid-cols-3 gap-10">
          <div className="col-span-2">
            <h2 className="mb-1 font-heading text-3xl text-warm-white">Place your bets</h2>
            <p className="mb-4 text-xl text-pale-stone">
              On your phone — nothing to tap here
            </p>
            <div className="grid grid-cols-2 gap-3">
              {categories.map(c => (
                <div key={c.key} className="rounded-lg border border-pale-stone/25 px-4 py-3">
                  <div className="text-sm uppercase tracking-overline text-pale-stone">{pick(c, 'en')}</div>
                  <div className="font-display text-3xl text-amber-gold">×{c.multiplier}</div>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <HintFeed hints={state?.revealed_hints ?? []} lang="en" />
            </div>
          </div>
          <Leaderboard players={players} max={12} />
        </div>
      )}

      {status === 'locked' && (
        <div className="flex min-h-[50vh] items-center justify-center">
          <p className="font-display text-7xl text-wine-red">BETS ARE CLOSED</p>
        </div>
      )}

      {status === 'revealed' && state?.reveal && (
        <div className="grid grid-cols-3 gap-10">
          <div className="col-span-2 space-y-4">
            {state.reveal.image_url && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={state.reveal.image_url} alt="" className="h-64 rounded-lg object-contain" />
            )}
            <h2 className="font-display text-6xl text-amber-gold">{state.reveal.name}</h2>
            <p className="font-heading text-3xl text-warm-white">
              {[state.reveal.country, state.reveal.region, state.reveal.grape, state.reveal.vintage,
                state.reveal.abv && `${state.reveal.abv}%`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <Leaderboard players={players} max={12} />
        </div>
      )}

      {/* The join details belong on screen the whole evening, not just in the
          lobby: a guest arriving mid-round has no other way to find the PIN,
          and the betting board above reads like an invitation to tap the TV. */}
      {gameStatus !== 'finished' && !beforeFirstWine && (
        <footer className="fixed inset-x-0 bottom-0 flex items-center justify-center gap-8 border-t border-pale-stone/15 bg-felt-light/80 px-8 py-3 backdrop-blur">
          <span className="text-lg text-pale-stone">Ставки с телефона · Bet from your phone</span>
          <span className="font-heading text-xl text-warm-white">{joinHost}</span>
          <span className="text-lg text-pale-stone">
            PIN <b className="font-display text-3xl tracking-display text-amber-gold">{pin}</b>
          </span>
        </footer>
      )}

      {gameStatus === 'finished' && (
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <p className="font-display text-7xl text-amber-gold">GAME OVER</p>
          <Leaderboard players={players} max={20} />
        </div>
      )}
    </main>
  )
}
