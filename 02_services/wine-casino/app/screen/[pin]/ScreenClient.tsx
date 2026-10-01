'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Chip } from '@/components/Chip'
import { QrPanel } from '@/components/QrPanel'
import { Timer } from '@/components/Timer'
import { usePrefersReducedMotion } from '@/lib/motion'
import { useLiveGame } from '@/lib/realtime'
import type { PublicPlayer } from '@/lib/realtime'
import { pick } from '@/lib/i18n'
import type { CategoryDef, Hint } from '@/lib/types'

// `useLayoutEffect` warns when it runs during a server render (it never does
// anything there). This page is client-only in practice, but Next still does
// one server pass for the initial HTML, so the standings' FLIP measurement
// falls back to `useEffect` on that pass and the real thing in the browser.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

// Beats, ~500-700ms apart, same rhythm the phone's reveal uses
// (app/play/page.tsx) -- the room and every guest's pocket land on the same
// cadence by construction, not by coincidence.
const BEAT_MS = 650
const SHOWER_MS = 650
const CHIP_FACES = [50, 25, 10, 5]

export function ScreenClient({
  gameId, pin, title, categories,
}: { gameId: string; pin: string; title: string; categories: CategoryDef[] }) {
  const { state, players } = useLiveGame(gameId)
  const reducedMotion = usePrefersReducedMotion()
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
    const raw = (process.env.NEXT_PUBLIC_CASINO_URL || '').trim()
    const base = raw || window.location.origin
    setJoinHost(base.replace(/^https?:\/\//i, '').replace(/\/+$/, ''))
  }, [])

  // ---- Reveal choreography -----------------------------------------------
  // Mirrors app/play/page.tsx: one shot of data (round_state + player rows),
  // staged locally into beats. Never changes what anything means, only when
  // it appears. revealBeat 0 = nothing yet, 1 = bottle, 2 = facts.
  const revealKey = status === 'revealed' && state?.wine_id ? `${gameId}:${state.wine_id}` : null
  const revealKeyRef = useRef<string | null>(null)
  const [revealBeat, setRevealBeat] = useState(0)

  // The money shot: who gained. lib/round.ts publishes the reveal *before*
  // moving any chips ("Settles the round: the only place chips ever move"),
  // so the player list at the instant revealKey first changes is reliably
  // the pre-payout bank for everyone -- not a race. Each subsequent `player`
  // row update (one per guest, as settlePlayer runs) is compared against that
  // snapshot; a rise means this guest just got paid, and a shower fires at
  // their row once. A guest who just got the bust-rescue also reads as a
  // rise here -- the public player row carries only id/nickname/chips (see
  // lib/realtime.ts's PublicPlayer), nothing marks a rescue apart from a
  // win, and this screen has no way to tell the two apart without more than
  // it is given. Both are, honestly, "the house just put chips in front of
  // you" -- a fine thing to celebrate either way.
  const snapshotRef = useRef<Record<string, number> | null>(null)
  const firedRef = useRef<Set<string>>(new Set())
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({})
  const revealOriginRef = useRef<HTMLDivElement | null>(null)
  const showerSeq = useRef(0)
  const [showers, setShowers] = useState<Shower[]>([])

  useEffect(() => {
    if (!revealKey || revealKey === revealKeyRef.current) return
    revealKeyRef.current = revealKey
    const snap: Record<string, number> = {}
    for (const p of players) snap[p.id] = p.chips
    snapshotRef.current = snap
    firedRef.current = new Set()
    setShowers([])

    if (reducedMotion) { setRevealBeat(2); return }
    setRevealBeat(0)
    const timers: ReturnType<typeof setTimeout>[] = []
    timers.push(setTimeout(() => setRevealBeat(1), 0))
    timers.push(setTimeout(() => setRevealBeat(2), BEAT_MS))
    return () => timers.forEach(clearTimeout)
    // players is read once, at the instant the key changes -- not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey, reducedMotion])

  // A new wine (or leaving 'revealed' entirely) resets the choreography.
  useEffect(() => { if (!revealKey) revealKeyRef.current = null }, [revealKey])

  // Fires a shower of chips from the bottle toward every guest whose balance
  // just rose, one guest at a time as their own `player` row update lands.
  useEffect(() => {
    if (!revealKey || revealKeyRef.current !== revealKey) return
    if (reducedMotion || revealBeat < 1) return
    const snap = snapshotRef.current
    const originEl = revealOriginRef.current
    if (!snap || !originEl) return

    const originRect = originEl.getBoundingClientRect()
    const origin = { x: originRect.left + Math.min(originRect.width, 320) / 2, y: originRect.top + 48 }

    const spawned: Shower[] = []
    for (const p of players) {
      if (firedRef.current.has(p.id)) continue
      const before = snap[p.id]
      if (before === undefined || p.chips <= before) continue
      firedRef.current.add(p.id)

      const rowRect = rowRefs.current[p.id]?.getBoundingClientRect()
      const to = rowRect ? { x: rowRect.left + 30, y: rowRect.top + rowRect.height / 2 } : origin
      const count = Math.max(2, Math.min(5, Math.round((p.chips - before) / 15)))
      for (let i = 0; i < count; i++) {
        spawned.push({
          id: ++showerSeq.current,
          value: CHIP_FACES[i % CHIP_FACES.length],
          from: origin,
          to: { x: to.x + (i - count / 2) * 6, y: to.y },
          delay: i * 80,
        })
      }
    }
    if (spawned.length) setShowers(prev => [...prev, ...spawned])
  }, [players, revealKey, reducedMotion, revealBeat])

  const bettingNow = status === 'betting'

  return (
    <main className="min-h-screen bg-felt p-10 pb-28">
      <header className="mb-8 flex items-start justify-between">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-6xl tracking-display text-amber-gold">{title}</h1>
          {/* Honest ambient "this screen is live" signal -- not tied to any
              bet, because nothing about an in-flight bet is public (see the
              betting section below). Just the room knowing the table hasn't
              frozen. */}
          {bettingNow && (
            <span className="mt-2 flex items-center gap-2 text-sm uppercase tracking-overline text-pale-stone/70">
              <Chip value={10} size={18} className="motion-safe:animate-pulse" />
              live
            </span>
          )}
        </div>
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
            <ArrivalGrid players={players} reducedMotion={reducedMotion} />
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
          <Standings players={players} max={20} reducedMotion={reducedMotion} />
        </div>
      )}

      {/* Betting: the dead spot. Nothing about a bet is public -- not even
          whether a given guest has one -- so what's below is built entirely
          from what is: the clock, the hints arriving on their own schedule,
          and the real headcount at the table. No "N still deciding" counter
          and no per-bet pulse, because there's no honest signal for either
          with the current data model (chips only move at reveal; casino.bet
          has no anon read policy). */}
      {status === 'betting' && (
        <div className="grid grid-cols-3 gap-10">
          <div className="col-span-2">
            <h2 className="mb-1 font-heading text-3xl text-warm-white">Place your bets</h2>
            <p className="mb-6 text-xl text-pale-stone">
              On your phone — nothing to tap here
            </p>
            <div className="grid grid-cols-2 gap-4">
              {categories.map((c, i) => (
                <div
                  key={c.key}
                  className="rounded-lg border border-pale-stone/25 px-6 py-5 motion-safe:animate-rise-in"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <div className="text-base uppercase tracking-overline text-pale-stone">{pick(c, 'en')}</div>
                  <div className="font-display text-4xl text-amber-gold">×{c.multiplier}</div>
                </div>
              ))}
            </div>
            <div className="mt-8">
              <ScreenHints hints={state?.revealed_hints ?? []} />
            </div>
          </div>
          <div>
            <h3 className="mb-3 text-sm uppercase tracking-overline text-pale-stone">
              At the table · {players.length}
            </h3>
            <Standings players={players} max={12} reducedMotion={reducedMotion} />
          </div>
        </div>
      )}

      {/* Bets are closed: a short, held beat, not another board of numbers. */}
      {status === 'locked' && (
        <div className="flex min-h-[55vh] flex-col items-center justify-center gap-6">
          <div className="flex gap-3 opacity-80">
            {[50, 25, 10].map((v, i) => (
              <span key={v} className="motion-safe:animate-pop-scale" style={{ animationDelay: `${i * 120}ms` }}>
                <Chip value={v} size={56} />
              </span>
            ))}
          </div>
          <p className="font-display text-8xl text-wine-red motion-safe:animate-rise-in" style={{ animationDelay: '360ms' }}>
            BETS ARE CLOSED
          </p>
          <p className="text-xl text-pale-stone motion-safe:animate-rise-in" style={{ animationDelay: '500ms' }}>
            No more chips on the table
          </p>
          <div className="mt-4 w-full max-w-2xl">
            <ScreenHints hints={state?.revealed_hints ?? []} />
          </div>
        </div>
      )}

      {/* Revealed: the money moment. The bottle arrives in beats, chips
          shower toward whoever just gained, and standings reorder instead of
          snapping (Standings' own FLIP). */}
      {status === 'revealed' && state?.reveal && (
        <div className="grid grid-cols-3 gap-10">
          <div ref={revealOriginRef} className="col-span-2 space-y-5">
            {revealBeat >= 1 && (
              <>
                {state.reveal.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={state.reveal.image_url} alt=""
                    className="h-64 rounded-lg object-contain motion-safe:animate-pop-scale"
                  />
                )}
                <h2 className="font-display text-6xl text-amber-gold motion-safe:animate-rise-in">
                  {state.reveal.name}
                </h2>
              </>
            )}
            {revealBeat >= 2 && (
              <p className="font-heading text-3xl text-warm-white motion-safe:animate-rise-in">
                {[state.reveal.country, state.reveal.region, state.reveal.grape, state.reveal.vintage,
                  state.reveal.abv && `${state.reveal.abv}%`].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <Standings
            players={players} max={12} reducedMotion={reducedMotion}
            registerRowRef={(id, el) => { rowRefs.current[id] = el }}
          />
        </div>
      )}

      {showers.map(s => (
        <ChipFly key={s.id} s={s} onDone={id => setShowers(prev => prev.filter(x => x.id !== id))} />
      ))}

      {/* The join details belong on screen the whole evening, not just in the
          lobby: a guest arriving mid-round has no other way to find the PIN,
          and the betting board above reads like an invitation to tap the TV. */}
      {gameStatus !== 'finished' && !beforeFirstWine && (
        <footer className="fixed inset-x-0 bottom-0 flex items-center justify-center gap-8 border-t border-pale-stone/15 bg-felt-light/80 px-8 py-3 backdrop-blur">
          <span className="text-lg text-pale-stone">Bet from your phone</span>
          <span className="font-heading text-xl text-warm-white">{joinHost}</span>
          <span className="text-lg text-pale-stone">
            PIN <b className="font-display text-3xl tracking-display text-amber-gold">{pin}</b>
          </span>
        </footer>
      )}

      {gameStatus === 'finished' && (
        <div className="mx-auto max-w-5xl space-y-4 text-center">
          <p className="font-display text-7xl text-amber-gold motion-safe:animate-rise-in">GAME OVER</p>
          <Podium players={players} reducedMotion={reducedMotion} />
        </div>
      )}
    </main>
  )
}

// ---- Local, TV-only pieces -------------------------------------------------
// Everything below is specific to the shared screen: bigger type, different
// rhythms (arrivals, reorders, a shower of chips) than the phone ever needs.
// They deliberately don't touch components/Leaderboard.tsx or HintFeed.tsx --
// same color tokens and structure, just scaled and wired for a room instead
// of a palm.

/** Lobby roster: new arrivals land with the same "landing" motion the chip
 *  picker uses when a chip is picked up, instead of silently appearing in a
 *  sorted list. Order follows join order (what useLiveGame hands back before
 *  anyone has chips to rank by), not a ranking nobody has earned yet. */
function ArrivalGrid({ players, reducedMotion }: { players: PublicPlayer[]; reducedMotion: boolean }) {
  const seen = useRef<Set<string>>(new Set())
  const [landing, setLanding] = useState<Set<string>>(new Set())

  useEffect(() => {
    const fresh: string[] = []
    for (const p of players) {
      if (!seen.current.has(p.id)) { seen.current.add(p.id); fresh.push(p.id) }
    }
    if (fresh.length === 0 || reducedMotion) return
    setLanding(prev => { const next = new Set(prev); fresh.forEach(id => next.add(id)); return next })
    const timer = setTimeout(() => {
      setLanding(prev => { const next = new Set(prev); fresh.forEach(id => next.delete(id)); return next })
    }, 500)
    return () => clearTimeout(timer)
  }, [players, reducedMotion])

  if (players.length === 0) {
    return <p className="text-xl text-pale-stone">Waiting for the first guest…</p>
  }

  return (
    <ul className="flex flex-wrap gap-3" aria-label="players at the table">
      {players.map(p => (
        <li
          key={p.id}
          className={[
            'rounded-md border border-pale-stone/25 bg-felt-light px-5 py-3 font-heading text-xl text-warm-white',
            landing.has(p.id) ? 'motion-safe:animate-pop-scale' : '',
          ].join(' ')}
        >
          {p.nickname}
        </li>
      ))}
    </ul>
  )
}

/** TV-sized hint feed. Same tokens as components/HintFeed.tsx, scaled up and
 *  with an entrance: a new <li> mounts (and animates in) exactly once, the
 *  moment its hint first appears, because React never remounts the earlier
 *  ones while they keep the same key. */
function ScreenHints({ hints }: { hints: Hint[] }) {
  if (hints.length === 0) return null
  return (
    <ul className="space-y-3">
      {hints.map((h, i) => (
        <li
          key={i}
          className="rounded-md border border-amber-gold/40 bg-amber-gold/10 px-6 py-4 motion-safe:animate-rise-in"
        >
          <span className="block text-sm uppercase tracking-overline text-amber-gold/80">Hint {i + 1}</span>
          <span className="text-2xl text-warm-white">{pick(h, 'en')}</span>
        </li>
      ))}
    </ul>
  )
}

/** TV-sized standings with FLIP reordering: a row is nudged from where it
 *  WAS to where it now is with a transform, then eased back to zero, so a
 *  rank change reads as a move rather than a cut. Transform-only. */
function Standings({
  players, max = 12, registerRowRef, reducedMotion,
}: {
  players: PublicPlayer[]
  max?: number
  registerRowRef?: (id: string, el: HTMLLIElement | null) => void
  reducedMotion: boolean
}) {
  const ranked = [...players].sort((a, b) => b.chips - a.chips || a.nickname.localeCompare(b.nickname))
  const rows = ranked.slice(0, max)

  const elRefs = useRef<Record<string, HTMLLIElement | null>>({})
  const prevTop = useRef<Record<string, number>>({})

  useIsoLayoutEffect(() => {
    const next: Record<string, number> = {}
    rows.forEach(p => {
      const el = elRefs.current[p.id]
      if (el) next[p.id] = el.getBoundingClientRect().top
    })
    if (!reducedMotion) {
      rows.forEach(p => {
        const el = elRefs.current[p.id]
        const prev = prevTop.current[p.id]
        const cur = next[p.id]
        if (el && prev !== undefined && cur !== undefined && Math.abs(prev - cur) > 0.5) {
          el.style.transition = 'none'
          el.style.transform = `translateY(${prev - cur}px)`
          // Flushes the "from" transform before the transition below is
          // attached, so the browser has something to tween away from
          // instead of batching both changes into the same frame.
          void el.getBoundingClientRect()
          el.style.transition = 'transform 550ms cubic-bezier(.2,.8,.2,1)'
          el.style.transform = ''
        }
      })
    }
    prevTop.current = next
  })

  if (rows.length === 0) {
    return <p className="text-lg text-pale-stone">No one at the table yet.</p>
  }

  return (
    <ol className="space-y-2">
      {rows.map((p, i) => (
        <li
          key={p.id}
          ref={el => { elRefs.current[p.id] = el; registerRowRef?.(p.id, el) }}
          className="flex items-center gap-4 rounded-md bg-graphite/30 px-4 py-3"
        >
          <span className="w-10 font-display text-2xl text-amber-gold">{i + 1}</span>
          <span className="flex-1 truncate font-heading text-xl text-warm-white">{p.nickname}</span>
          <span className="font-display text-2xl tabular-nums text-warm-white">{p.chips}</span>
        </li>
      ))}
    </ol>
  )
}

/** The podium: top three on pedestals (the champion climaxes the entrance,
 *  appearing last), everyone else underneath as an ordinary list. */
function Podium({ players, reducedMotion }: { players: PublicPlayer[]; reducedMotion: boolean }) {
  const ranked = [...players].sort((a, b) => b.chips - a.chips || a.nickname.localeCompare(b.nickname))
  if (ranked.length === 0) return <p className="text-xl text-pale-stone">No one played.</p>

  const [first, second, third] = ranked
  const rest = ranked.slice(3)
  const slots = [
    { p: third, place: 3 as const, delay: 0, height: 'h-28', accent: 'text-cream', order: 3 },
    { p: second, place: 2 as const, delay: 180, height: 'h-40', accent: 'text-pale-stone', order: 1 },
    { p: first, place: 1 as const, delay: 360, height: 'h-56', accent: 'text-amber-gold', order: 2 },
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-12">
      <div className="flex items-end justify-center gap-6">
        {slots.map(({ p, place, delay, height, accent, order }) => p && (
          <div
            key={p.id}
            className="flex w-56 flex-col items-center motion-safe:animate-rise-in"
            style={{ animationDelay: `${delay}ms`, order }}
          >
            <div className={`mb-2 max-w-full truncate font-heading text-2xl ${accent}`}>{p.nickname}</div>
            <div className={`mb-3 font-display text-4xl tabular-nums ${accent}`}>{p.chips}</div>
            <div className={`flex w-full ${height} items-start justify-center rounded-t-lg border border-pale-stone/25 bg-felt-light pt-3`}>
              <span className={`font-display text-6xl ${accent}`}>{place}</span>
            </div>
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="mx-auto max-w-xl">
          <h3 className="mb-3 text-center text-sm uppercase tracking-overline text-pale-stone">
            The rest of the table
          </h3>
          <Standings players={rest} max={17} reducedMotion={reducedMotion} />
        </div>
      )}
    </div>
  )
}

// ---- The chip shower --------------------------------------------------------

type Shower = { id: number; value: number; from: { x: number; y: number }; to: { x: number; y: number }; delay: number }

/** One chip, flying from the bottle to a winner's row. Same mechanic as
 *  components/BetBoard.tsx's FlyingChip (transform + opacity, nothing else),
 *  just re-homed here since that one isn't exported and this screen's
 *  origin/destination points are different. */
function ChipFly({ s, onDone }: { s: Shower; onDone: (id: number) => void }) {
  const [arrived, setArrived] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setArrived(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => onDone(s.id), SHOWER_MS + s.delay + 80)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dx = s.to.x - s.from.x
  const dy = s.to.y - s.from.y

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: s.from.x - 18,
        top: s.from.y - 18,
        zIndex: 60,
        pointerEvents: 'none',
        transform: arrived ? `translate(${dx}px, ${dy}px) scale(0.6)` : 'translate(0px, 0px) scale(1)',
        opacity: arrived ? 0 : 1,
        transitionProperty: 'transform, opacity',
        transitionDuration: `${SHOWER_MS}ms`,
        transitionTimingFunction: 'cubic-bezier(.2,.8,.2,1)',
        transitionDelay: `${s.delay}ms`,
      }}
    >
      <Chip value={s.value} size={36} />
    </div>
  )
}
