'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BetBoard } from '@/components/BetBoard'
import { HintFeed } from '@/components/HintFeed'
import { Leaderboard } from '@/components/Leaderboard'
import { Timer } from '@/components/Timer'
import { useLiveGame } from '@/lib/realtime'
import { clearSession, loadSession } from '@/lib/session'
import type { Session } from '@/lib/session'
import { t } from '@/lib/i18n'
import type { BetLine } from '@/lib/bets'
import type { CategoryDef, Lang } from '@/lib/types'

type MyBet = { category: string; option: string; amount: number; isCorrect: boolean | null; payout: number | null }

export default function Play() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [categories, setCategories] = useState<CategoryDef[]>([])
  const [myBets, setMyBets] = useState<MyBet[]>([])
  const [rescued, setRescued] = useState(false)
  const [lang, setLang] = useState<Lang>('ru')

  useEffect(() => {
    const s = loadSession()
    if (!s) { router.replace('/'); return }
    setSession(s)
    setLang(s.lang)
  }, [router])

  const { state, players, connected } = useLiveGame(session?.gameId ?? null, session?.playerId ?? null)

  // Categories and the settled slip come from the REST endpoint; Realtime only
  // carries round_state and player rows.
  useEffect(() => {
    if (!session) return
    const qs = new URLSearchParams({ gameId: session.gameId, playerId: session.playerId })
    fetch(`/api/state?${qs}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        setCategories(j.game?.categories ?? [])
        setMyBets(j.myBets ?? [])
        setRescued(j.me?.rescued === true)
      })
      .catch(() => { /* the poller in useLiveGame will retry */ })
  }, [session, state?.wine_id, state?.round_status])

  const me = useMemo(
    () => players.find(p => p.id === session?.playerId) ?? null,
    [players, session],
  )

  async function saveSlip(slip: BetLine[]): Promise<{ ok: boolean; error?: string }> {
    if (!session || !state?.wine_id) return { ok: false, error: 'errGeneric' }
    const res = await fetch('/api/bet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId, playerToken: session.playerToken,
        wineId: state.wine_id, slip,
      }),
    })
    if (res.ok) return { ok: true }
    const { error } = await res.json().catch(() => ({ error: 'errGeneric' }))
    return { ok: false, error: error === 'insufficient_chips' ? 'errBank' : error === 'round_closed' ? 'errClosed' : 'errGeneric' }
  }

  if (!session) return null

  const chips = me?.chips ?? 0
  const status = state?.round_status ?? 'pending'
  const gameStatus = state?.game_status ?? 'lobby'

  return (
    <main className="mx-auto min-h-screen max-w-md p-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-overline text-pale-stone">{session.nickname}</div>
          <div className="font-display text-3xl text-amber-gold">
            {chips} <span className="text-base text-pale-stone">{t('bank', lang)}</span>
          </div>
        </div>
        <div className="text-right">
          {state?.wine_id && (
            <div className="text-xs uppercase tracking-overline text-pale-stone">
              {t('roundOf', lang)} {state.round_no}/{state.total_rounds}
            </div>
          )}
          {status === 'betting' && <Timer endsAt={state?.ends_at ?? null} />}
        </div>
      </header>

      {!connected && (
        <p className="mb-3 rounded-md bg-graphite/40 px-3 py-2 text-xs text-pale-stone">
          {t('reconnecting', lang)}
        </p>
      )}

      {gameStatus === 'finished' && (
        <section className="space-y-4">
          <h2 className="font-display text-4xl text-amber-gold">{t('finished', lang)}</h2>
          <Leaderboard players={players} highlightId={session.playerId} max={20} />
        </section>
      )}

      {gameStatus !== 'finished' && status === 'pending' && (
        <section className="space-y-4">
          <p className="text-pale-stone">{t('lobbyWaiting', lang)}</p>
          <h3 className="text-xs uppercase tracking-overline text-pale-stone">{t('lobbyPlayers', lang)}</h3>
          <Leaderboard players={players} highlightId={session.playerId} max={30} />
        </section>
      )}

      {status === 'betting' && state?.wine_id && (
        <>
          <div className="mb-4">
            <HintFeed hints={state.revealed_hints} lang={lang} />
          </div>
          <BetBoard
            wineId={state.wine_id}
            options={state.options}
            categories={categories}
            chips={chips}
            lang={lang}
            onSave={saveSlip}
          />
        </>
      )}

      {status === 'locked' && (
        <section className="space-y-3">
          <p className="font-heading text-xl text-wine-red">{t('betsClosed', lang)}</p>
          <HintFeed hints={state?.revealed_hints ?? []} lang={lang} />
        </section>
      )}

      {status === 'revealed' && state?.reveal && (
        <section className="space-y-4">
          <div className="rounded-lg border border-amber-gold/40 bg-felt/60 p-4">
            <h2 className="font-heading text-xl">{state.reveal.name}</h2>
            <p className="text-sm text-pale-stone">
              {[state.reveal.country, state.reveal.region, state.reveal.grape, state.reveal.vintage]
                .filter(Boolean).join(' · ')}
            </p>
          </div>

          <ul className="space-y-1 text-sm">
            {myBets.map((b, i) => (
              <li key={i} className="flex justify-between rounded-md bg-graphite/30 px-3 py-2">
                <span className="text-pale-stone">{b.option}</span>
                <span className={b.isCorrect === true ? 'text-amber-gold' : b.isCorrect === null ? 'text-pale-stone' : 'text-wine-red'}>
                  {b.isCorrect === true ? `${t('correct', lang)} +${b.payout}` :
                   b.isCorrect === null ? t('voided', lang) : `${t('wrong', lang)} −${b.amount}`}
                </span>
              </li>
            ))}
          </ul>

          {rescued && (
            <p className="rounded-md border border-amber-gold/50 bg-amber-gold/10 px-3 py-2 text-sm text-amber-gold">
              {t('rescued', lang)}
            </p>
          )}

          <Leaderboard players={players} highlightId={session.playerId} />
        </section>
      )}

      <footer className="mt-10 text-center">
        <button onClick={() => { clearSession(); router.replace('/') }} className="text-xs text-pale-stone/60 underline">
          exit
        </button>
      </footer>
    </main>
  )
}
