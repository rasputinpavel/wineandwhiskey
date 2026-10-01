'use client'
import { useEffect, useRef } from 'react'
import { useCountdown } from '@/lib/realtime'

const SIZES = {
  md: { box: 64, stroke: 5, text: 'text-xl' },
  xl: { box: 220, stroke: 10, text: 'text-7xl' },
} as const

/** A ring that drains as the round runs, with the seconds left inside it.
 *  `useCountdown` is the only source of truth for time; this component only
 *  ever turns that number into a drawing. */
export function Timer({ endsAt, size = 'md' }: { endsAt: string | null; size?: 'md' | 'xl' }) {
  const left = useCountdown(endsAt)

  // The ring needs a denominator and the wire only ever carries `ends_at`, so
  // the first (highest) value seen since this round started is taken as the
  // round's full length. Resets whenever endsAt changes -- i.e. a new round.
  const totalRef = useRef<number | null>(null)
  useEffect(() => { totalRef.current = null }, [endsAt])
  if (left > 0 && (totalRef.current === null || left > totalRef.current)) {
    totalRef.current = left
  }

  // Unknown total (the very first tick of a round) reads as a full ring
  // rather than an empty one -- a blink of "already drained" would be worse
  // than a blink of "full".
  const fraction = totalRef.current ? Math.max(0, Math.min(1, left / totalRef.current)) : 1
  const urgent = left > 0 && left <= 10

  const { box, stroke, text } = SIZES[size]
  const r = (box - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - fraction)

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: box, height: box }}
      role="timer"
      aria-label={`${left}`}
    >
      <svg width={box} height={box} className="-rotate-90">
        <circle cx={box / 2} cy={box / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-pale-stone/15" />
        <circle
          cx={box / 2} cy={box / 2} r={r} fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={[
            'transition-[stroke-dashoffset] duration-200 ease-linear',
            urgent ? 'stroke-wine-red' : 'stroke-amber-gold',
          ].join(' ')}
        />
      </svg>
      <span
        className={[
          'absolute font-display tabular-nums tracking-display',
          text,
          urgent ? 'text-wine-red motion-safe:animate-pulse' : 'text-amber-gold',
        ].join(' ')}
      >
        {left}
      </span>
    </div>
  )
}
