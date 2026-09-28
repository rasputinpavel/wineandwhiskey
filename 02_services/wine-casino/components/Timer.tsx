'use client'
import { useCountdown } from '@/lib/realtime'

export function Timer({ endsAt, size = 'md' }: { endsAt: string | null; size?: 'md' | 'xl' }) {
  const left = useCountdown(endsAt)
  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  // Under ten seconds the clock turns red — visible from across a dim room.
  const urgent = left > 0 && left <= 10

  return (
    <div
      className={[
        'font-display tabular-nums tracking-display',
        size === 'xl' ? 'text-8xl' : 'text-3xl',
        urgent ? 'text-wine-red animate-pulse' : 'text-amber-gold',
      ].join(' ')}
    >
      {mm}:{ss}
    </div>
  )
}
