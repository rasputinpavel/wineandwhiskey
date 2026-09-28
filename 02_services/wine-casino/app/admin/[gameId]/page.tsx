'use client'
import { use, useCallback, useEffect, useState } from 'react'
import { WineEditor } from './WineEditor'
import type { EditableWine } from './WineEditor'
import type { CategoryDef, Difficulty, GameStatus } from '@/lib/types'

type Game = {
  id: string; pin: string; host_token: string; title: string; status: GameStatus
  difficulty: Difficulty; starting_chips: number; rescue_chips: number
  round_seconds: number; categories: CategoryDef[]
}

type Hit = {
  sku_id: string; name: string
  wine_color: string | null; grape_variety: string | null; wine_country: string | null
}

export default function GameEditor({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = use(params)
  const [game, setGame] = useState<Game | null>(null)
  const [wines, setWines] = useState<EditableWine[]>([])
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/games/${gameId}`, { cache: 'no-store' })
    if (!res.ok) return
    const json = await res.json()
    setGame(json.game)
    setWines(json.wines)
  }, [gameId])

  useEffect(() => { void load() }, [load])

  // Inventory search: v_sku_breakdown gives us colour, grape and country.
  // Region and vintage are never in there — they get typed in below.
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/admin/inventory?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
      if (res.ok) setHits((await res.json()).hits)
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  async function addWine(payload: Record<string, unknown>) {
    await fetch(`/api/admin/games/${gameId}/wines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setQ('')
    setHits([])
    await load()
  }

  async function patchGame(patch: Record<string, unknown>) {
    await fetch(`/api/admin/games/${gameId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    await load()
  }

  if (!game) return <main className="p-6">Loading…</main>

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header>
        <h1 className="font-display text-4xl tracking-display text-amber-gold">{game.title}</h1>
        <p className="text-sm text-pale-stone">PIN {game.pin} · {game.status}</p>
        <div className="mt-2 space-y-1 text-sm">
          <div>Host panel: <a className="text-amber-gold underline" href={`/host?t=${game.host_token}`}>{origin}/host?t={game.host_token}</a></div>
          <div>TV screen: <a className="text-amber-gold underline" href={`/screen/${game.pin}`}>{origin}/screen/{game.pin}</a></div>
        </div>
      </header>

      <section className="grid grid-cols-4 gap-3 rounded-lg border border-pale-stone/20 p-4">
        <label className="text-sm">Difficulty
          <select
            className="mt-1 w-full rounded-md bg-graphite/40 px-2 py-2"
            value={game.difficulty}
            onChange={e => patchGame({ difficulty: e.target.value })}
          >
            <option value="easy">easy</option>
            <option value="medium">medium</option>
            <option value="hard">hard</option>
            <option value="pro">pro</option>
          </select>
        </label>
        <label className="text-sm">Round, sec
          <input
            className="mt-1 w-full rounded-md bg-graphite/40 px-2 py-2" type="number"
            defaultValue={game.round_seconds}
            onBlur={e => patchGame({ roundSeconds: Number(e.target.value) })}
          />
        </label>
        <label className="text-sm">Start chips
          <input
            className="mt-1 w-full rounded-md bg-graphite/40 px-2 py-2" type="number"
            defaultValue={game.starting_chips}
            onBlur={e => patchGame({ startingChips: Number(e.target.value) })}
          />
        </label>
        <label className="text-sm">Rescue chips
          <input
            className="mt-1 w-full rounded-md bg-graphite/40 px-2 py-2" type="number"
            defaultValue={game.rescue_chips}
            onBlur={e => patchGame({ rescueChips: Number(e.target.value) })}
          />
        </label>
        <p className="col-span-4 text-xs text-pale-stone">
          Changing difficulty, round length or categories rebuilds every wine’s board and hint texts.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-xl">Add a wine</h2>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search our inventory…"
          className="w-full rounded-md bg-graphite/40 px-4 py-2 outline-none"
        />
        {hits.length > 0 && (
          <ul className="divide-y divide-pale-stone/10 rounded-md bg-graphite/20">
            {hits.map(h => (
              <li key={h.sku_id}>
                <button
                  onClick={() => addWine({
                    sku: h.sku_id, name: h.name,
                    country: h.wine_country, grape: h.grape_variety, color: h.wine_color,
                  })}
                  className="w-full px-4 py-2 text-left hover:bg-graphite/40"
                >
                  {h.name}
                  <span className="ml-2 text-xs text-pale-stone">
                    {[h.wine_country, h.grape_variety].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={() => addWine({ name: 'New wine' })}
          className="rounded-md border border-pale-stone/40 px-4 py-2 text-sm"
        >
          Add blank wine
        </button>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-xl">Running order ({wines.length})</h2>
        {wines.map(w => <WineEditor key={w.id} gameId={gameId} wine={w} onSaved={load} />)}
      </section>
    </main>
  )
}
