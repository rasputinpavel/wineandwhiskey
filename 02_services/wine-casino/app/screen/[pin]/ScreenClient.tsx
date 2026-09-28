'use client'
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

  return (
    <main className="min-h-screen bg-felt p-10">
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
      {gameStatus !== 'finished' && status === 'pending' && (
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

      {status === 'betting' && (
        <div className="grid grid-cols-3 gap-10">
          <div className="col-span-2">
            <h2 className="mb-4 font-heading text-3xl text-warm-white">Place your bets</h2>
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

      {gameStatus === 'finished' && (
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <p className="font-display text-7xl text-amber-gold">GAME OVER</p>
          <Leaderboard players={players} max={20} />
        </div>
      )}
    </main>
  )
}
