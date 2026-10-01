'use client'
import { Chip } from './Chip'
import { t } from '@/lib/i18n'
import type { Lang } from '@/lib/types'

const DENOMS = [5, 10, 25, 50]

/** Denomination selector, drawn as real chips. Tapping one picks it up (it
 *  lifts); tapping a board button then stakes however many chips that
 *  denomination is worth -- far fewer taps on a phone than a stepper per
 *  option. */
export function ChipPicker({
  value, available, onChange, lang, registerRef,
}: {
  value: number
  available: number
  onChange: (v: number) => void
  lang: Lang
  /** Lets the caller (BetBoard) find a chip's on-screen position to animate
   *  a copy of it flying to the option the guest taps. Purely cosmetic --
   *  the picker works with or without it. */
  registerRef?: (denom: number, el: HTMLButtonElement | null) => void
}) {
  const usable = DENOMS.filter(d => d <= available)
  const choices = usable.length > 0 ? usable : [available].filter(a => a > 0)

  return (
    <div className="flex items-end gap-3">
      {choices.map(d => (
        <button
          key={d}
          ref={el => registerRef?.(d, el)}
          onClick={() => onChange(d)}
          aria-label={String(d)}
          aria-pressed={d === value}
          className="flex items-center justify-center p-1"
        >
          <Chip value={d} size={48} lifted={d === value} />
        </button>
      ))}
      {available > 0 && (
        <button
          ref={el => registerRef?.(available, el)}
          onClick={() => onChange(available)}
          aria-label={t('allIn', lang)}
          aria-pressed={value === available}
          className="flex items-center justify-center p-1"
        >
          <Chip value={available} label={t('allIn', lang)} variant="allin" size={48} lifted={value === available} />
        </button>
      )}
    </div>
  )
}
