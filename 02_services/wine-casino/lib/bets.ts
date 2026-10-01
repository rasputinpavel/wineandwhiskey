import { canon } from './text'
import { ALL_REGIONS, COUNTRIES } from './wine-data'
import type { CategoryKey, Option, RoundStatus } from './types'

export type BetLine = { category: CategoryKey; option: string; amount: number }

// Country and region are `open` categories (see lib/categories.ts): there is
// no board for them (lib/options.ts builds none), so a typed guess is checked
// against our own dictionaries instead. Everything else still has a button
// board and is checked against it below, exactly as before.
//
// Both sets are canon()-folded once at module load, matching the fold applied
// to every incoming guess — the same rule lib/text.ts states for the rest of
// the money path: the two sides of a comparison must agree on what "the same
// string" means, or a typed answer that matches an entry by eye fails to match
// it by code (an accent, a stray space, a different case).
const COUNTRY_VALUES = new Set(COUNTRIES.map(c => canon(c.value)))
const REGION_VALUES = new Set(Array.from(ALL_REGIONS, canon))

export type BetError =
  | 'wrong_game'
  | 'round_closed'
  | 'unknown_category'
  | 'unknown_option'
  | 'bad_amount'
  | 'duplicate_bet'
  | 'insufficient_chips'

export type BetValidation = { ok: true; total: number } | { ok: false; error: BetError }

/**
 * Validates a complete replacement slip for the current wine. The phone is not
 * trusted about anything: category, option and amount are all re-checked
 * against the stored board and the server-side chip count.
 */
export function validateBetSlip(input: {
  roundStatus: RoundStatus
  activeCategories: readonly CategoryKey[]
  options: Partial<Record<CategoryKey, Option[]>>
  playerChips: number
  slip: readonly BetLine[]
  /** The game the player belongs to, and the game the wine belongs to. */
  playerGameId: string
  wineGameId: string
}): BetValidation {
  if (input.playerGameId !== input.wineGameId) return { ok: false, error: 'wrong_game' }
  if (input.roundStatus !== 'betting') return { ok: false, error: 'round_closed' }

  const seen = new Set<string>()
  let total = 0

  for (const line of input.slip) {
    if (!input.activeCategories.includes(line.category)) return { ok: false, error: 'unknown_category' }

    // Compared through the same canon() that settleRound uses to decide whether
    // a bet won. Two different notions of "the same string" in the two halves of
    // the money path is how you end up accepting a bet you then score as wrong.
    const value = canon(line.option)
    const recognised =
      line.category === 'country' ? COUNTRY_VALUES.has(value) :
      line.category === 'region'  ? REGION_VALUES.has(value) :
      (input.options[line.category] ?? []).some(o => canon(o.value) === value)
    if (!recognised) return { ok: false, error: 'unknown_option' }

    if (!Number.isInteger(line.amount) || line.amount < 1) return { ok: false, error: 'bad_amount' }

    // Keyed by the canonical value, not the raw text: a choice category can only
    // ever send one spelling (the board's), but an open category's guest can
    // type "Chile" and "CHILE" as two slip lines that mean the same bet. Keying
    // on the raw string would let that through as two separate stakes on one
    // answer — the same money-path bug the comparison above exists to avoid.
    const key = `${line.category}:${value}`
    if (seen.has(key)) return { ok: false, error: 'duplicate_bet' }
    seen.add(key)

    total += line.amount
  }

  if (total > input.playerChips) return { ok: false, error: 'insufficient_chips' }
  return { ok: true, total }
}
