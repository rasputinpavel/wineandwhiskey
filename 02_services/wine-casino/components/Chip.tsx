'use client'

// A physical casino chip, drawn once in SVG and reused everywhere a bet shows
// up: the denomination picker, the flying chip, the stacks on each option,
// and the reveal screen. Pure decoration -- it carries no betting logic and
// renders the same markup regardless of what the game state means.

const PALETTE: Record<number, { fill: string; edge: string; text: string }> = {
  5:  { fill: '#EDE0D0', edge: '#D4C9BC', text: '#1A1A1A' }, // cream
  10: { fill: '#C9A84C', edge: '#8C6E2A', text: '#1A1A1A' }, // amber-gold
  25: { fill: '#8C1C1C', edge: '#F5F0EB', text: '#F5F0EB' }, // wine-red
  50: { fill: '#5C1010', edge: '#C9A84C', text: '#C9A84C' }, // burgundy-deep
}
const DEFAULT_COLOR = { fill: '#1D4739', edge: '#D4C9BC', text: '#F5F0EB' } // felt-light
const ALLIN_COLOR   = { fill: '#14342B', edge: '#C9A84C', text: '#C9A84C' } // felt, gold ring

const NOTCHES = 12

function paletteFor(value: number, variant?: 'allin') {
  if (variant === 'allin') return ALLIN_COLOR
  return PALETTE[value] ?? DEFAULT_COLOR
}

export function Chip({
  value, size = 48, lifted = false, label, variant, className = '',
}: {
  value: number
  size?: number
  /** Reads as "picked up off the table" -- the selected denomination. */
  lifted?: boolean
  /** Overrides the printed text (e.g. "ALL") without changing the colour lookup. */
  label?: string
  variant?: 'allin'
  className?: string
}) {
  const { fill, edge, text } = paletteFor(value, variant)
  const printed = label ?? String(value)

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      className={[
        'transition-transform duration-150 ease-out',
        lifted ? '-translate-y-1.5 scale-110 drop-shadow-[0_6px_10px_rgba(0,0,0,0.5)]' : 'drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]',
        className,
      ].join(' ')}
    >
      <circle cx="32" cy="32" r="29" fill={fill} stroke={edge} strokeWidth="2" />
      {/* Edge notches -- the detail that reads "chip" instead of "coin". */}
      {Array.from({ length: NOTCHES }).map((_, i) => (
        <rect
          key={i}
          x="30.5" y="2.5" width="3" height="6" rx="1"
          fill={edge}
          opacity={0.85}
          transform={`rotate(${(360 / NOTCHES) * i} 32 32)`}
        />
      ))}
      <circle cx="32" cy="32" r="21" fill="none" stroke={edge} strokeWidth="1.5" opacity="0.5" />
      <text
        x="32" y="37.5"
        textAnchor="middle"
        fontSize={printed.length > 2 ? 13 : 17}
        fontFamily="'Bebas Neue', system-ui, sans-serif"
        letterSpacing="0.02em"
        fill={text}
      >
        {printed}
      </text>
    </svg>
  )
}

/** Greedy, display-only breakdown of an amount into chip faces. Not the
 *  ledger -- just which denominations look right piled on top of each other. */
function breakdownChips(amount: number, maxChips: number): number[] {
  if (amount <= 0) return []
  const denoms = [50, 25, 10, 5]
  let remaining = amount
  const chips: number[] = []
  for (const d of denoms) {
    while (remaining >= d && chips.length < maxChips) {
      chips.push(d)
      remaining -= d
    }
  }
  if (remaining > 0 && chips.length < maxChips) chips.push(remaining)
  return chips
}

/** A pile of chips standing in for a bet amount, instead of a numeric badge. */
export function ChipStack({
  amount, size = 20, maxChips = 5, className = '',
}: { amount: number; size?: number; maxChips?: number; className?: string }) {
  if (amount <= 0) return null
  const chips = breakdownChips(amount, maxChips)
  const rise = size * 0.22

  return (
    <span
      className={['relative inline-block', className].join(' ')}
      style={{ width: size, height: size + (chips.length - 1) * rise }}
    >
      {chips.map((v, i) => (
        <span
          key={i}
          className="absolute left-0"
          style={{ bottom: i * rise, zIndex: i }}
        >
          <Chip value={v} size={size} />
        </span>
      ))}
    </span>
  )
}
