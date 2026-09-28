'use client'

const DENOMS = [5, 10, 25, 50]

/** Denomination selector. Tapping a board button stakes this many chips, which
 *  is far fewer taps on a phone than a stepper per option. */
export function ChipPicker({
  value, available, onChange,
}: { value: number; available: number; onChange: (v: number) => void }) {
  const usable = DENOMS.filter(d => d <= available)
  const choices = usable.length > 0 ? usable : [available].filter(a => a > 0)

  return (
    <div className="flex gap-2">
      {choices.map(d => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={[
            'h-12 w-12 rounded-full border-2 font-display text-lg tabular-nums',
            d === value
              ? 'border-amber-gold bg-amber-gold text-deep-black'
              : 'border-pale-stone/40 text-pale-stone',
          ].join(' ')}
        >
          {d}
        </button>
      ))}
      {available > 0 && (
        <button
          onClick={() => onChange(available)}
          className={[
            'h-12 rounded-full border-2 px-4 font-heading text-sm',
            value === available
              ? 'border-wine-red bg-wine-red text-warm-white'
              : 'border-wine-red/60 text-wine-red',
          ].join(' ')}
        >
          ALL {available}
        </button>
      )}
    </div>
  )
}
