'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Difficulty, GameStatus } from '@/lib/types'

type Row = {
  id: string; pin: string; title: string; status: GameStatus
  difficulty: Difficulty; created_at: string
}

export default function AdminGames() {
  const [games, setGames] = useState<Row[]>([])
  const [title, setTitle] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [busy, setBusy] = useState(false)

  async function load() {
    const res = await fetch('/api/admin/games', { cache: 'no-store' })
    if (res.ok) setGames((await res.json()).games)
  }
  useEffect(() => { void load() }, [])

  async function create() {
    setBusy(true)
    await fetch('/api/admin/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, difficulty }),
    })
    setBusy(false)
    setTitle('')
    await load()
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <h1 className="font-display text-4xl tracking-display text-amber-gold">Wine Casino — games</h1>

      <section className="flex gap-2">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Evening name"
          className="flex-1 rounded-md bg-graphite/40 px-4 py-2 outline-none"
        />
        <select
          value={difficulty}
          onChange={e => setDifficulty(e.target.value as Difficulty)}
          className="rounded-md bg-graphite/40 px-3 py-2"
        >
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
          <option value="pro">pro</option>
        </select>
        <button disabled={busy} onClick={create} className="rounded-md bg-amber-gold px-5 py-2 text-deep-black">
          New game
        </button>
      </section>

      <ul className="space-y-2">
        {games.map(g => (
          <li key={g.id}>
            <Link
              href={`/admin/${g.id}`}
              className="flex items-center justify-between rounded-md bg-graphite/30 px-4 py-3 hover:bg-graphite/50"
            >
              <span>
                <b>{g.title}</b>
                <span className="ml-3 text-sm text-pale-stone">PIN {g.pin} · {g.difficulty} · {g.status}</span>
              </span>
              <span className="text-xs text-pale-stone">{new Date(g.created_at).toLocaleDateString()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
