'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BetBoard } from '@/components/BetBoard'
import { Chip, ChipStack } from '@/components/Chip'
import { HintFeed } from '@/components/HintFeed'
import { LangToggle } from '@/components/LangToggle'
import { Leaderboard } from '@/components/Leaderboard'
import { Timer } from '@/components/Timer'
import { usePrefersReducedMotion } from '@/lib/motion'
import { useCountdown, useLiveGame } from '@/lib/realtime'
import { clearSession, loadSession } from '@/lib/session'
import type { Session } from '@/lib/session'
import { t } from '@/lib/i18n'
import type { BetLine } from '@/lib/bets'
import type { CategoryDef, Lang } from '@/lib/types'

type MyBet = { category: string; option: string; amount: number; isCorrect: boolean | null; payout: number | null }

// Beats, ~500-700ms apart: bottle name -> bottle facts -> each bet, oldest
// first -> balance rolls -> rescue gift (if any) -> leaderboard.
const BEAT_MS = 650

export default function Play() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [categories, setCategories] = useState<CategoryDef[]>([])
  const [myBets, setMyBets] = useState<MyBet[]>([])
  const [rescued, setRescued] = useState(false)
  const [lang, setLang] = useState<Lang>('ru')
  const reducedMotion = usePrefersReducedMotion()

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
    // Proves identity so the server hands back this player's own slip — the
    // PIN is public, so an id in the query string alone proves nothing.
    fetch(`/api/state?${qs}`, { cache: 'no-store', headers: { 'x-player-token': session.playerToken } })
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

  // Must run on every render, before the early return below, or the hook
  // count changes between the "no session yet" and "session loaded" renders.
  const secondsLeft = useCountdown(state?.ends_at ?? null)

  const chips = me?.chips ?? 0
  const status = state?.round_status ?? 'pending'
  const gameStatus = state?.game_status ?? 'lobby'
  // round_status stays 'pending' both before the first wine and between every
  // pair of wines, so it alone can't tell "nobody has played yet" from
  // "everyone's waiting for the next pour" -- only the quiet-state copy below
  // needs that distinction.
  const beforeFirstWine = gameStatus === 'lobby' && (state?.round_no ?? 0) === 0

  // ---- Reveal choreography ---------------------------------------------
  // Everything the reveal shows arrives in one shot (round_state + myBets).
  // This just decides, locally, how much of what already arrived is visible
  // right now. It never changes what anything means -- only when it appears.
  const revealKey = status === 'revealed' && state?.wine_id ? `${session?.gameId}:${state.wine_id}` : null
  const revealKeyRef = useRef<string | null>(null)
  const [revealBeat, setRevealBeat] = useState(0)     // 0 none, 1 name, 2 + facts/bets
  const [betsShown, setBetsShown] = useState(0)
  const [showBalance, setShowBalance] = useState(false)
  const [showRescue, setShowRescue] = useState(false)
  const [showBoard, setShowBoard] = useState(false)
  // The balance the guest had walking INTO this reveal. The host panel
  // publishes the reveal before it moves any chips (lib/round.ts), so the
  // `chips` value at the instant this effect first sees `revealed` is still
  // the pre-payout number -- that is what the roll animates from.
  const balanceFromRef = useRef<number | null>(null)
  const [displayedChips, setDisplayedChips] = useState(chips)

  useEffect(() => {
    if (!revealKey || revealKey === revealKeyRef.current) return
    revealKeyRef.current = revealKey
    balanceFromRef.current = chips

    if (reducedMotion) {
      setRevealBeat(2); setBetsShown(myBets.length); setShowBalance(true); setShowRescue(true); setShowBoard(true)
      return
    }

    setRevealBeat(0); setBetsShown(0); setShowBalance(false); setShowRescue(false); setShowBoard(false)
    const timers: ReturnType<typeof setTimeout>[] = []
    let at = 0
    timers.push(setTimeout(() => setRevealBeat(1), at))
    timers.push(setTimeout(() => setRevealBeat(2), at += BEAT_MS))
    for (let i = 0; i < myBets.length; i++) {
      timers.push(setTimeout(() => setBetsShown(n => n + 1), at += BEAT_MS))
    }
    timers.push(setTimeout(() => setShowBalance(true), at += BEAT_MS))
    if (rescued) timers.push(setTimeout(() => setShowRescue(true), at += BEAT_MS))
    timers.push(setTimeout(() => setShowBoard(true), at += BEAT_MS))

    return () => timers.forEach(clearTimeout)
    // myBets.length / rescued only matter at the moment the key changes --
    // their content (isCorrect/payout) settles moments later and is read at
    // render time, not captured here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey, reducedMotion])

  // A new wine (or leaving 'revealed' entirely) resets the choreography so
  // the next reveal starts from the top.
  useEffect(() => {
    if (!revealKey) revealKeyRef.current = null
  }, [revealKey])

  // The header number: mirrors the live balance normally, holds at the
  // pre-reveal snapshot through the early beats, then rolls once the balance
  // beat starts. Reduced motion skips straight to the end state.
  useEffect(() => {
    if (status !== 'revealed') { setDisplayedChips(chips); return }
    const from = balanceFromRef.current ?? chips
    if (!showBalance || reducedMotion || from === chips) { setDisplayedChips(reducedMotion ? chips : from); return }
    let raf = 0
    const start = performance.now()
    const duration = 700
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      setDisplayedChips(Math.round(from + (chips - from) * p))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [showBalance, status, chips, reducedMotion])

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

  // The clock is enforced server-side (app/api/bet/route.ts), but the board
  // must also disappear the moment it hits zero: a guest who waits out the
  // timer should not still see a live board with no time risk on it.
  const bettingOpen = status === 'betting' && Boolean(state?.wine_id) && secondsLeft > 0

  return (
    <main className="mx-auto min-h-screen max-w-md p-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-overline text-pale-stone">{session.nickname}</div>
          <div className="font-display text-3xl text-amber-gold tabular-nums">
            {displayedChips} <span className="text-base text-pale-stone">{t('bank', lang)}</span>
          </div>
        </div>
        <div className="text-right">
          {state?.wine_id && (
            <div className="text-xs uppercase tracking-overline text-pale-stone">
              {t('roundOf', lang)} {state.round_no}/{state.total_rounds}
            </div>
          )}
          {status === 'betting' && (
            <div className="mt-1 flex justify-end">
              <Timer endsAt={state?.ends_at ?? null} />
            </div>
          )}
          {/* Picking the wrong language at the join screen used to be a
              one-way door: the only way out was `exit`, which cost the seat
              and the chips. This only changes what this device displays --
              it is never written back to the server. */}
          <div className="mt-2 flex justify-end">
            <LangToggle lang={lang} onChange={setLang} />
          </div>
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

      {/* Lobby and the gap between wines: the quiet majority of the evening
          for a guest who has already bet. A static chip + a steady breath
          reads as "the table is still live", not "nothing is happening". */}
      {gameStatus !== 'finished' && status === 'pending' && (
        <section className="space-y-4">
          <div className="rounded-lg border border-pale-stone/15 bg-felt/40 p-6 text-center">
            <div className="mb-3 flex justify-center motion-safe:animate-pulse">
              <Chip value={10} size={40} />
            </div>
            <p className="text-pale-stone">{beforeFirstWine ? t('lobbyWaiting', lang) : t('betweenWines', lang)}</p>
          </div>
          <h3 className="text-xs uppercase tracking-overline text-pale-stone">{t('lobbyPlayers', lang)}</h3>
          <Leaderboard players={players} highlightId={session.playerId} max={30} />
        </section>
      )}

      {bettingOpen && state?.wine_id && (
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

      {/* Bets are closed but not revealed yet. The chips are decorative --
          not a readout of the guest's actual stake -- just the table saying
          "something is still on it". */}
      {(status === 'locked' || (status === 'betting' && !bettingOpen)) && (
        <section className="space-y-3">
          <div className="rounded-lg border border-wine-red/25 bg-felt/40 p-6 text-center">
            <div className="mb-3 flex justify-center gap-2 opacity-70">
              <Chip value={10} size={26} />
              <Chip value={25} size={26} />
              <Chip value={50} size={26} />
            </div>
            <p className="font-heading text-xl text-wine-red">{t('betsClosed', lang)}</p>
          </div>
          <HintFeed hints={state?.revealed_hints ?? []} lang={lang} />
        </section>
      )}

      {status === 'revealed' && state?.reveal && (
        <section className="space-y-4">
          <div className="rounded-lg border border-amber-gold/40 bg-felt/60 p-4">
            {revealBeat >= 1 && (
              <h2 className="font-heading text-xl motion-safe:animate-rise-in">{state.reveal.name}</h2>
            )}
            {revealBeat >= 2 && (
              <p className="mt-1 text-sm text-pale-stone motion-safe:animate-rise-in">
                {[state.reveal.country, state.reveal.region, state.reveal.grape, state.reveal.vintage]
                  .filter(Boolean).join(' · ')}
              </p>
            )}
          </div>

          {betsShown > 0 && (
            <ul className="space-y-1.5 text-sm">
              {myBets.slice(0, betsShown).map((b, i) => {
                const won = b.isCorrect === true
                const lost = b.isCorrect === false
                return (
                  <li
                    key={`${b.category}:${b.option}`}
                    className={[
                      'relative flex items-center justify-between gap-3 overflow-hidden rounded-md border px-3 py-2 motion-safe:animate-rise-in',
                      won ? 'border-amber-gold/50 bg-felt-light' : lost ? 'border-pale-stone/10 bg-graphite/20' : 'border-pale-stone/20 bg-graphite/30',
                    ].join(' ')}
                  >
                    {/* A correct bet flashes gold once, right as it lands. */}
                    {won && (
                      <span className="pointer-events-none absolute inset-0 bg-amber-gold motion-safe:animate-flash-opacity" aria-hidden="true" />
                    )}
                    <span className="relative z-10 text-pale-stone">{b.option}</span>
                    <span className="relative z-10 flex items-center gap-2">
                      <ChipStack
                        amount={won ? (b.payout ?? b.amount) : b.amount}
                        size={16}
                        maxChips={4}
                        className={[lost ? 'motion-safe:animate-fade-shrink' : '', won ? 'motion-safe:animate-pop-scale' : ''].join(' ')}
                      />
                      <span className={won ? 'text-amber-gold' : lost ? 'text-wine-red' : 'text-pale-stone'}>
                        {won ? `${t('correct', lang)} +${b.payout}` : lost ? `${t('wrong', lang)} −${b.amount}` : t('voided', lang)}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {rescued && showRescue && (
            <p className="rounded-md border border-amber-gold/50 bg-amber-gold/10 px-3 py-2 text-sm text-amber-gold motion-safe:animate-pop-scale">
              {t('rescued', lang)}
            </p>
          )}

          {showBoard && (
            <div className="motion-safe:animate-rise-in">
              <Leaderboard players={players} highlightId={session.playerId} />
            </div>
          )}
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
