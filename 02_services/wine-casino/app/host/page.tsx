'use client'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Timer } from '@/components/Timer'
import { Leaderboard } from '@/components/Leaderboard'
import type { CategoryDef, Hint, RoundStatus, WineAnswers } from '@/lib/types'

type HostWine = {
  id: string; order_no: number; label: string; name: string
  country: string | null; region: string | null; grape: string | null
  vintage: number | null; style: string | null; abv: number | null
  answers: WineAnswers; hints: Hint[]; status: RoundStatus; ends_at: string | null
}

type HostState = {
  game: {
    id: string; pin: string; title: string; status: string
    difficulty: string; round_seconds: number; categories: CategoryDef[]
    current_wine_id: string | null
  }
  wines: HostWine[]
  players: Array<{ id: string; nickname: string; chips: number }>
  state: { round_status: RoundStatus; ends_at: string | null; revealed_hints: Hint[] } | null
}

const TICK_MS = 2000

function HostPanel() {
  const token = useSearchParams().get('t') ?? ''
  const [data, setData] = useState<HostState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!token) return
    const res = await fetch(`/api/host/state?t=${token}`, { cache: 'no-store' })
    if (!res.ok) { setError('Bad host link'); return }
    setData(await res.json())
  }, [token])

  useEffect(() => { void refresh() }, [refresh])

  // The host's browser is the game clock. Nothing else reveals hints.
  useEffect(() => {
    if (!token) return
    const timer = setInterval(async () => {
      if (data?.state?.round_status !== 'betting') return
      await fetch('/api/host/tick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ t: token }),
      }).catch(() => { /* one missed tick just delays a hint by two seconds */ })
      void refresh()
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [token, data?.state?.round_status, refresh])

  async function act(action: 'open' | 'start' | 'lock' | 'reveal' | 'next') {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/host/round', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t: token, action }),
    })
    setBusy(false)
    if (!res.ok) { setError(`Action "${action}" failed`); return }
    await refresh()
  }

  if (!token) return <main className="p-8">Missing host token.</main>
  if (!data) return <main className="p-8">{error ?? 'Loading…'}</main>

  const current = data.wines.find(w => w.id === data.game.current_wine_id) ?? null
  const status = data.state?.round_status ?? 'pending'

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-display text-amber-gold">{data.game.title}</h1>
          <p className="text-sm text-pale-stone">
            PIN {data.game.pin} · {data.game.difficulty} · {data.players.length} players
          </p>
        </div>
        {status === 'betting' && <Timer endsAt={data.state?.ends_at ?? null} />}
      </header>

      {error && <p className="rounded-md bg-wine-red/20 px-3 py-2 text-sm text-wine-red">{error}</p>}

      <section className="rounded-lg border border-pale-stone/20 p-4">
        {current ? (
          <>
            <div className="mb-1 text-xs uppercase tracking-overline text-pale-stone">
              {current.label} · round {current.order_no}/{data.wines.length} · {status}
            </div>
            <h2 className="font-heading text-xl">{current.name}</h2>
            <p className="text-sm text-pale-stone">
              {[current.country, current.region, current.grape, current.vintage, current.abv && `${current.abv}%`]
                .filter(Boolean).join(' · ')}
            </p>
            {data.state && data.state.revealed_hints.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-amber-gold">
                {data.state.revealed_hints.map((h, i) => <li key={i}>· {h.en}</li>)}
              </ul>
            )}
          </>
        ) : (
          <p className="text-pale-stone">No wine selected. Open the lobby, then press Start.</p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-2">
        <button disabled={busy} onClick={() => act('open')} className="rounded-md border border-pale-stone/40 py-3">
          Open lobby
        </button>
        <button disabled={busy || status === 'betting'} onClick={() => act('start')} className="rounded-md bg-amber-gold py-3 text-deep-black disabled:opacity-40">
          Start round
        </button>
        <button disabled={busy || status !== 'betting'} onClick={() => act('lock')} className="rounded-md border border-wine-red py-3 text-wine-red disabled:opacity-40">
          Close bets
        </button>
        <button disabled={busy || (status !== 'locked' && status !== 'betting')} onClick={() => act('reveal')} className="rounded-md bg-wine-red py-3 disabled:opacity-40">
          Reveal
        </button>
        <button disabled={busy || status !== 'revealed'} onClick={() => act('next')} className="col-span-2 rounded-md border border-amber-gold py-3 text-amber-gold disabled:opacity-40">
          Next wine
        </button>
      </div>

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-overline text-pale-stone">Leaderboard</h3>
        <Leaderboard players={data.players} max={30} />
      </section>

      <section>
        <h3 className="mb-2 text-xs uppercase tracking-overline text-pale-stone">Running order</h3>
        <ol className="space-y-1 text-sm">
          {data.wines.map(w => (
            <li key={w.id} className={w.id === data.game.current_wine_id ? 'text-amber-gold' : 'text-pale-stone'}>
              {w.order_no}. {w.name} — {w.status}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}

export default function Host() {
  return <Suspense><HostPanel /></Suspense>
}
