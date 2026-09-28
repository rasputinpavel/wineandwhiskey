import { canon } from './text'
import type { CategoryKey, Option, RoundStatus } from './types'

export type BetLine = { category: CategoryKey; option: string; amount: number }

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
    const board = input.options[line.category] ?? []
    if (!board.some(o => canon(o.value) === canon(line.option))) {
      return { ok: false, error: 'unknown_option' }
    }

    if (!Number.isInteger(line.amount) || line.amount < 1) return { ok: false, error: 'bad_amount' }

    const key = `${line.category}:${line.option}`
    if (seen.has(key)) return { ok: false, error: 'duplicate_bet' }
    seen.add(key)

    total += line.amount
  }

  if (total > input.playerChips) return { ok: false, error: 'insufficient_chips' }
  return { ok: true, total }
}
