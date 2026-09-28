'use client'
import type { PublicPlayer } from '@/lib/realtime'

export function Leaderboard({
  players, highlightId, max = 12,
}: { players: PublicPlayer[]; highlightId?: string | null; max?: number }) {
  const ranked = [...players].sort((a, b) => b.chips - a.chips || a.nickname.localeCompare(b.nickname))

  return (
    <ol className="space-y-1">
      {ranked.slice(0, max).map((p, i) => (
        <li
          key={p.id}
          className={[
            'flex items-center gap-3 rounded-md px-3 py-2',
            p.id === highlightId ? 'bg-amber-gold/20 ring-1 ring-amber-gold' : 'bg-graphite/30',
          ].join(' ')}
        >
          <span className="w-6 font-display text-xl text-amber-gold">{i + 1}</span>
          <span className="flex-1 truncate">{p.nickname}</span>
          <span className="font-display text-xl tabular-nums">{p.chips}</span>
        </li>
      ))}
    </ol>
  )
}
