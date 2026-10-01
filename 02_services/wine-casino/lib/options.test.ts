import { describe, it, expect } from 'vitest'
import { buildOptions, OPTION_COUNTS } from './options'
import { DEFAULT_CATEGORIES } from './categories'
import { GRAPES } from './wine-data'
import type { CategoryKey, WineFacts } from './types'

// Categories that still render as a button board. Country and region are free
// entry now (see categories.ts) and never produce an `options` entry — see the
// "open categories" block near the bottom of this file. Style survives here
// only because buildOptions still has to build its board for a game created
// before style left the betting ladder (see options.ts's comment on why).
const BOARD: CategoryKey[] = ['style', 'world', 'grape', 'vintage']
const ALL: CategoryKey[] = ['style', 'world', 'country', 'grape', 'region', 'vintage']

const chianti: WineFacts = {
  name: 'Castello di Gabbiano Chianti Classico',
  country: 'Italy',
  region: 'Toscana',
  grape: 'Sangiovese',
  vintage: 2019,
  style: 'dry',
  color: 'red',
  abv: 13.5,
}

// A deterministic RNG so the assertions do not depend on Math.random.
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

describe('buildOptions', () => {
  it('always includes the correct answer in every board category', () => {
    const o = buildOptions(chianti, BOARD, seeded(1))
    expect(o.style!.map(x => x.value)).toContain('dry')
    expect(o.world!.map(x => x.value)).toContain('old')
    expect(o.grape!.map(x => x.value)).toContain('sangiovese')
    expect(o.vintage!.map(x => x.value)).toContain('2019')
  })

  it('never exceeds the configured option count', () => {
    const o = buildOptions(chianti, BOARD, seeded(2))
    for (const key of ['world', 'grape', 'vintage'] as const) {
      expect(o[key]!.length).toBeLessThanOrEqual(OPTION_COUNTS[key]!)
    }
  })

  it('never repeats an option inside a category', () => {
    const o = buildOptions(chianti, BOARD, seeded(3))
    for (const key of BOARD) {
      const values = o[key]!.map(x => x.value)
      expect(new Set(values).size).toBe(values.length)
    }
  })

  it('offers only red grapes as decoys for a red wine', () => {
    const o = buildOptions(chianti, BOARD, seeded(4))
    expect(o.grape!.map(x => x.value)).not.toContain('chardonnay')
    expect(o.grape!.map(x => x.value)).not.toContain('riesling')
  })

  it('offers only white grapes as decoys for a white wine', () => {
    const riesling: WineFacts = { ...chianti, grape: 'Riesling', color: 'white', country: 'Germany', region: 'Mosel' }
    const o = buildOptions(riesling, BOARD, seeded(5))
    expect(o.grape!.map(x => x.value)).not.toContain('merlot')
  })

  it('derives the grape decoy pool from the correct grape when the bottle colour is blank', () => {
    // A hand-entered wine with no recorded colour used to fall back to the
    // whole grape pool — a Sauvignon Blanc could get five red decoys and one
    // white option, giving the answer away without tasting. The pool must come
    // from the correct grape's own group (known from our table) instead.
    const noColor: WineFacts = { ...chianti, grape: 'Sauvignon Blanc', color: null, country: 'France', region: 'Bordeaux' }
    for (const seed of [1, 2, 3, 4, 5]) {
      const o = buildOptions(noColor, BOARD, seeded(seed))
      expect(o.grape!.map(x => x.value)).toContain('sauvignon blanc')
      for (const value of o.grape!.map(x => x.value)) {
        const g = GRAPES.find(x => x.value === value)
        expect(g?.group).not.toBe('red')
      }
    }
  })

  it('still widens to the whole pool when neither the bottle nor our table knows the colour', () => {
    // Kisi is outside our GRAPES table and, with no bottle colour either,
    // genuinely unknown — the old behaviour (fall back to everything) is the
    // only honest option left once the grape's own group cannot be read.
    const kisi: WineFacts = { ...chianti, grape: 'Kisi', color: null, country: 'Georgia', region: 'Kakheti' }
    const o = buildOptions(kisi, BOARD, seeded(6))
    expect(o.grape!.length).toBe(OPTION_COUNTS.grape)
  })

  it('gives vintage options in ascending order around the true year', () => {
    const o = buildOptions(chianti, BOARD, seeded(6))
    const years = o.vintage!.map(x => Number(x.value))
    expect(years).toEqual([...years].sort((a, b) => a - b))
    expect(years).toContain(2019)
    expect(years.length).toBe(OPTION_COUNTS.vintage)
  })

  it('does not put the true vintage in the same slot every time', () => {
    const positions = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map(seed => {
        const o = buildOptions(chianti, BOARD, seeded(seed))
        return o.vintage!.findIndex(x => x.value === '2019')
      }),
    )
    expect(positions.size).toBeGreaterThan(1)
  })

  it('never makes a blind guess profitable: every choice category’s multiplier fits its button count', () => {
    // Betting A chips on a uniform guess returns A*(m - n)/n, so m > n pays
    // ignorance better than knowledge. This invariant is the whole reason
    // the ladder's option counts are what they are. It only applies to
    // `choice` categories — `open` categories have no button count to check
    // against (and no board at all), see the test below.
    for (const cat of DEFAULT_CATEGORIES.filter(c => c.input === 'choice')) {
      expect(cat.multiplier).toBeLessThanOrEqual(OPTION_COUNTS[cat.key]!)
    }
  })

  it('never builds a board — or assigns a button count — for an open category', () => {
    // The point of this test is to stop someone silently making an open
    // category behave like a sized board again (and, with it, ignorance
    // profitable): country and region must stay free-text, forever.
    for (const cat of DEFAULT_CATEGORIES.filter(c => c.input === 'open')) {
      expect(OPTION_COUNTS[cat.key]).toBeUndefined()
      const o = buildOptions(chianti, [cat.key], seeded(42))
      expect(o[cat.key]).toBeUndefined()
    }
  })

  it('treats an off-canon style as missing instead of posting an unwinnable board', () => {
    const offDry: WineFacts = { ...chianti, style: 'off-dry' }
    expect(buildOptions(offDry, BOARD, seeded(11)).style).toBeUndefined()
  })

  it('never offers a vintage that has not happened yet', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const o = buildOptions({ ...chianti, vintage: 2025 }, BOARD, seeded(seed), 2026)
      for (const opt of o.vintage!) {
        expect(Number(opt.value)).toBeLessThanOrEqual(2026)
      }
      expect(o.vintage!.map(x => x.value)).toContain('2025')
    }
  })

  it('skips the vintage category for a wine from the current year', () => {
    // Only one legal window exists for a current-year wine, so the answer would
    // always sit on the last button. A year older and the window can move again.
    expect(buildOptions({ ...chianti, vintage: 2026 }, BOARD, seeded(3), 2026).vintage).toBeUndefined()
    expect(buildOptions({ ...chianti, vintage: 2025 }, BOARD, seeded(3), 2026).vintage)
      .toHaveLength(OPTION_COUNTS.vintage!)
  })

  it('skips a category whose fact is missing', () => {
    const noGrape: WineFacts = { ...chianti, grape: null, vintage: null }
    const o = buildOptions(noGrape, BOARD, seeded(7))
    expect(o.grape).toBeUndefined()
    expect(o.vintage).toBeUndefined()
    expect(o.world).toBeDefined()
  })

  it('skips a category the game has turned off', () => {
    const o = buildOptions(chianti, ['style', 'world'], seeded(8))
    expect(o.grape).toBeUndefined()
    expect(o.vintage).toBeUndefined()
    expect(o.style).toBeDefined()
    expect(o.world).toBeDefined()
  })

  it('treats orange wine as white for grape decoys and still fills the board', () => {
    const orange: WineFacts = { ...chianti, grape: 'Rkatsiteli', color: 'orange', country: 'Georgia', region: 'Kakheti' }
    const o = buildOptions(orange, BOARD, seeded(9))
    expect(o.grape!.length).toBe(OPTION_COUNTS.grape)
  })

  it('still builds a style board for a game that still runs it (pre-ladder-change categories)', () => {
    // Style left the default ladder, but buildOptions must keep knowing how to
    // build its board — existing games store their own categories array and
    // keep working (see README and categories.ts).
    const o = buildOptions(chianti, ['style'], seeded(1))
    expect(o.style!.map(x => x.value)).toContain('dry')
    expect(o.style!.length).toBe(4)
  })
})

describe('buildOptions — open categories (country, region)', () => {
  it('never produces a country or region board, even when the fact is present and the category is active', () => {
    const o = buildOptions(chianti, ALL, seeded(10))
    expect(o.country).toBeUndefined()
    expect(o.region).toBeUndefined()
    // Everything else on a full category list still builds normally.
    expect(o.style).toBeDefined()
    expect(o.world).toBeDefined()
    expect(o.grape).toBeDefined()
    expect(o.vintage).toBeDefined()
  })
})
