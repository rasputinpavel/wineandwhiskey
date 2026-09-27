import { canon } from './text'
import type { CategoryDef, CategoryKey, WineAnswers } from './types'

export type PlacedBet = {
  /** casino.bet.id, carried through untouched. The reveal route writes each
   *  outcome back to its own row by this id rather than trusting that the
   *  result array still lines up positionally with what it passed in. */
  id: string
  playerId: string
  category: CategoryKey
  option: string
  amount: number
}

/** `isCorrect: null` means the bet was voided and the stake returned. */
export type SettledBet = PlacedBet & { isCorrect: boolean | null; payout: number }

export type PlayerSettlement = {
  id: string
  chipsBefore: number
  chipsAfter: number
  staked: number
  won: number
  rescued: boolean
}

export type SettleResult = { bets: SettledBet[]; players: PlayerSettlement[] }

/**
 * Settle one wine. Chips are only moved here — placing a bet does not touch a
 * player's balance, it just reserves against it (see bets.ts).
 */
export function settleRound(input: {
  bets: readonly PlacedBet[]
  answers: WineAnswers
  categories: readonly CategoryDef[]
  players: ReadonlyArray<{ id: string; chips: number }>
  rescueChips: number
}): SettleResult {
  // A host can type the rescue amount into the game settings form. Zero is a
  // legitimate choice (rescue disabled); negative would set a busted guest's
  // balance below zero while reporting them rescued.
  if (!Number.isFinite(input.rescueChips) || input.rescueChips < 0) {
    throw new Error(`settleRound: rescueChips must be a number >= 0, got ${input.rescueChips}`)
  }

  // A bet whose player is not at the table gets its payout computed and shown,
  // but credited to nobody — money on a screen that never reaches a balance.
  // Fail loudly; a caller that hands us a mismatched pair has a bug.
  const seated = new Set(input.players.map(p => p.id))
  const orphan = input.bets.find(b => !seated.has(b.playerId))
  if (orphan) {
    throw new Error(`settleRound: bet ${orphan.id} is from unknown player ${orphan.playerId}`)
  }

  const multiplier = new Map(input.categories.map(c => [c.key, c.multiplier]))

  const bets: SettledBet[] = input.bets.map(b => {
    const answer = input.answers[b.category]
    const m = multiplier.get(b.category)
    // Either we never recorded the answer, or the category is not in play.
    // Void the bet and give the stake back: a gap in our data entry is our
    // mistake, and a guest must never lose chips to it.
    if (answer == null || answer === '' || m == null) {
      return { ...b, isCorrect: null, payout: b.amount }
    }
    const isCorrect = canon(answer) === canon(b.option)
    return { ...b, isCorrect, payout: isCorrect ? Math.round(b.amount * m) : 0 }
  })

  const players: PlayerSettlement[] = input.players.map(p => {
    const mine = bets.filter(b => b.playerId === p.id)
    const staked = mine.reduce((s, b) => s + b.amount, 0)
    const won = mine.reduce((s, b) => s + b.payout, 0)
    let chipsAfter = p.chips - staked + won
    let rescued = false
    // A busted guest stops playing and starts looking at their phone. Hand them
    // a small stack so they stay in the game — a deliberate break from the
    // classic rules, see the spec.
    if (chipsAfter <= 0) {
      chipsAfter = input.rescueChips
      rescued = true
    }
    return { id: p.id, chipsBefore: p.chips, chipsAfter, staked, won, rescued }
  })

  return { bets, players }
}
