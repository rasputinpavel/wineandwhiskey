import { describe, it, expect } from 'vitest'
import { validateBetSlip } from './bets'
import type { BetLine } from './bets'
import type { CategoryKey, Option } from './types'

// 'grape' stands in for a generic board (`choice`) category below — country and
// region moved to free entry (`open`) and get their own describe block further
// down, since they are no longer checked against a board at all.
const options: Partial<Record<CategoryKey, Option[]>> = {
  grape: [
    { value: 'sangiovese', ru: 'Sangiovese', en: 'Sangiovese' },
    { value: 'merlot',     ru: 'Merlot',     en: 'Merlot' },
  ],
  world: [
    { value: 'old', ru: 'Старый Свет', en: 'Old World' },
    { value: 'new', ru: 'Новый Свет',  en: 'New World' },
  ],
}

const active: CategoryKey[] = ['world', 'grape', 'country', 'region']

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
    expect(check([{ category: 'grape', option: 'sangiovese', amount: 30 }])).toEqual({ ok: true, total: 30 })
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
    expect(check([{ category: 'grape', option: 'sangiovese', amount: 5 }], 100, 'betting', { wineGameId: 'g2' }))
      .toEqual({ ok: false, error: 'wrong_game' })
  })

  it('rejects everything once the round is locked', () => {
    expect(check([{ category: 'grape', option: 'sangiovese', amount: 1 }], 100, 'locked'))
      .toEqual({ ok: false, error: 'round_closed' })
  })

  it('rejects a category the game does not run', () => {
    expect(check([{ category: 'vintage', option: '2019', amount: 5 }]))
      .toEqual({ ok: false, error: 'unknown_category' })
  })

  it('rejects an option that is not on this wine’s board', () => {
    // Chardonnay is a grape we genuinely know (wine-data.ts), but it is not on
    // THIS wine's board — a choice category only ever accepts its own board,
    // dictionary membership does not matter. That is the whole distinction
    // between `choice` and `open` categories; see the block below for `open`.
    expect(check([{ category: 'grape', option: 'chardonnay', amount: 5 }]))
      .toEqual({ ok: false, error: 'unknown_option' })
  })

  it('rejects a zero, negative or fractional stake', () => {
    expect(check([{ category: 'grape', option: 'sangiovese', amount: 0 }])).toEqual({ ok: false, error: 'bad_amount' })
    expect(check([{ category: 'grape', option: 'sangiovese', amount: -5 }])).toEqual({ ok: false, error: 'bad_amount' })
    expect(check([{ category: 'grape', option: 'sangiovese', amount: 2.5 }])).toEqual({ ok: false, error: 'bad_amount' })
  })

  it('rejects the same option twice — the phone should have summed it', () => {
    expect(check([
      { category: 'grape', option: 'sangiovese', amount: 5 },
      { category: 'grape', option: 'sangiovese', amount: 5 },
    ])).toEqual({ ok: false, error: 'duplicate_bet' })
  })

  it('rejects a slip that exceeds the bank', () => {
    expect(check([
      { category: 'grape', option: 'sangiovese', amount: 60 },
      { category: 'world', option: 'old', amount: 50 },
    ], 100)).toEqual({ ok: false, error: 'insufficient_chips' })
  })

  it('allows betting the whole bank', () => {
    expect(check([{ category: 'grape', option: 'sangiovese', amount: 100 }], 100)).toEqual({ ok: true, total: 100 })
  })
})

describe('validateBetSlip — open categories (country, region)', () => {
  // Country and region have no board at all (lib/options.ts builds none for
  // them), so `options.country` / `options.region` are absent here on purpose
  // — that is the real shape the server hands validateBetSlip for these
  // categories once a wine is prepared under the new ladder.

  it('accepts a country we recognise even though there is no board for it', () => {
    expect(check([{ category: 'country', option: 'Chile', amount: 10 }])).toEqual({ ok: true, total: 10 })
  })

  it('is case- and accent-insensitive for a typed country', () => {
    expect(check([{ category: 'country', option: '  CHILE ', amount: 5 }])).toEqual({ ok: true, total: 5 })
  })

  it('rejects a country we do not recognise', () => {
    expect(check([{ category: 'country', option: 'Freedonia', amount: 5 }]))
      .toEqual({ ok: false, error: 'unknown_option' })
  })

  it('accepts a region we recognise, drawn straight from the wine-data dictionary', () => {
    expect(check([{ category: 'region', option: 'Toscana', amount: 10 }])).toEqual({ ok: true, total: 10 })
  })

  it('is accent-insensitive for a typed region', () => {
    expect(check([{ category: 'region', option: 'rias baixas', amount: 10 }])).toEqual({ ok: true, total: 10 })
  })

  it('rejects a region we do not recognise', () => {
    expect(check([{ category: 'region', option: 'Narnia', amount: 10 }]))
      .toEqual({ ok: false, error: 'unknown_option' })
  })

  it('treats two different-cased spellings of the same country as one duplicate bet', () => {
    // A choice category can only ever submit one spelling (the board's); a
    // free-typed one can submit "Chile" and "CHILE" as two slip lines that are
    // really the same stake. Both must collapse to one bet, not two.
    expect(check([
      { category: 'country', option: 'Chile', amount: 5 },
      { category: 'country', option: 'CHILE', amount: 5 },
    ])).toEqual({ ok: false, error: 'duplicate_bet' })
  })
})
