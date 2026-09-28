import { describe, it, expect } from 'vitest'
import { validateBetSlip } from './bets'
import type { BetLine } from './bets'
import type { CategoryKey, Option } from './types'

const options: Partial<Record<CategoryKey, Option[]>> = {
  country: [
    { value: 'italy',  ru: 'Италия',  en: 'Italy' },
    { value: 'france', ru: 'Франция', en: 'France' },
  ],
  world: [
    { value: 'old', ru: 'Старый Свет', en: 'Old World' },
    { value: 'new', ru: 'Новый Свет',  en: 'New World' },
  ],
}

const active: CategoryKey[] = ['country', 'world']

function check(
  slip: BetLine[],
  playerChips = 100,
  roundStatus: 'betting' | 'locked' = 'betting',
  ids: { playerGameId?: string; wineGameId?: string } = {},
) {
  return validateBetSlip({
    roundStatus,
    activeCategories: active,
    options,
    playerChips,
    slip,
    playerGameId: ids.playerGameId ?? 'g1',
    wineGameId: ids.wineGameId ?? 'g1',
  })
}

describe('validateBetSlip', () => {
  it('accepts a slip within the player’s bank', () => {
    expect(check([{ category: 'country', option: 'italy', amount: 30 }])).toEqual({ ok: true, total: 30 })
  })

  it('accepts an empty slip — passing is a legal move', () => {
    expect(check([])).toEqual({ ok: true, total: 0 })
  })

  it('accepts a hedge across two options in one category', () => {
    const r = check([
      { category: 'world', option: 'old', amount: 10 },
      { category: 'world', option: 'new', amount: 10 },
    ])
    expect(r).toEqual({ ok: true, total: 20 })
  })

  it('rejects a bet aimed at a wine from another game', () => {
    // A phone left open on last week's game must not reach into tonight's.
    expect(check([{ category: 'country', option: 'italy', amount: 5 }], 100, 'betting', { wineGameId: 'g2' }))
      .toEqual({ ok: false, error: 'wrong_game' })
  })

  it('rejects everything once the round is locked', () => {
    expect(check([{ category: 'country', option: 'italy', amount: 1 }], 100, 'locked'))
      .toEqual({ ok: false, error: 'round_closed' })
  })

  it('rejects a category the game does not run', () => {
    expect(check([{ category: 'vintage', option: '2019', amount: 5 }]))
      .toEqual({ ok: false, error: 'unknown_category' })
  })

  it('rejects an option that is not on this wine’s board', () => {
    expect(check([{ category: 'country', option: 'chile', amount: 5 }]))
      .toEqual({ ok: false, error: 'unknown_option' })
  })

  it('rejects a zero, negative or fractional stake', () => {
    expect(check([{ category: 'country', option: 'italy', amount: 0 }])).toEqual({ ok: false, error: 'bad_amount' })
    expect(check([{ category: 'country', option: 'italy', amount: -5 }])).toEqual({ ok: false, error: 'bad_amount' })
    expect(check([{ category: 'country', option: 'italy', amount: 2.5 }])).toEqual({ ok: false, error: 'bad_amount' })
  })

  it('rejects the same option twice — the phone should have summed it', () => {
    expect(check([
      { category: 'country', option: 'italy', amount: 5 },
      { category: 'country', option: 'italy', amount: 5 },
    ])).toEqual({ ok: false, error: 'duplicate_bet' })
  })

  it('rejects a slip that exceeds the bank', () => {
    expect(check([
      { category: 'country', option: 'italy', amount: 60 },
      { category: 'world', option: 'old', amount: 50 },
    ], 100)).toEqual({ ok: false, error: 'insufficient_chips' })
  })

  it('allows betting the whole bank', () => {
    expect(check([{ category: 'country', option: 'italy', amount: 100 }], 100)).toEqual({ ok: true, total: 100 })
  })
})
