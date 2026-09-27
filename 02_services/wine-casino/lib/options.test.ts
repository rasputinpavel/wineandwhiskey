import { describe, it, expect } from 'vitest'
import { buildOptions, OPTION_COUNTS } from './options'
import { DEFAULT_CATEGORIES } from './categories'
import type { CategoryKey, WineFacts } from './types'

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
  it('always includes the correct answer in every category', () => {
    const o = buildOptions(chianti, ALL, seeded(1))
    expect(o.style!.map(x => x.value)).toContain('dry')
    expect(o.world!.map(x => x.value)).toContain('old')
    expect(o.country!.map(x => x.value)).toContain('italy')
    expect(o.grape!.map(x => x.value)).toContain('sangiovese')
    expect(o.region!.map(x => x.value)).toContain('toscana')
    expect(o.vintage!.map(x => x.value)).toContain('2019')
  })

  it('never exceeds the configured option count', () => {
    const o = buildOptions(chianti, ALL, seeded(2))
    for (const key of ALL) {
      expect(o[key]!.length).toBeLessThanOrEqual(OPTION_COUNTS[key])
    }
  })

  it('never repeats an option inside a category', () => {
    const o = buildOptions(chianti, ALL, seeded(3))
    for (const key of ALL) {
      const values = o[key]!.map(x => x.value)
      expect(new Set(values).size).toBe(values.length)
    }
  })

  it('offers only red grapes as decoys for a red wine', () => {
    const o = buildOptions(chianti, ALL, seeded(4))
    expect(o.grape!.map(x => x.value)).not.toContain('chardonnay')
    expect(o.grape!.map(x => x.value)).not.toContain('riesling')
  })

  it('offers only white grapes as decoys for a white wine', () => {
    const riesling: WineFacts = { ...chianti, grape: 'Riesling', color: 'white', country: 'Germany', region: 'Mosel' }
    const o = buildOptions(riesling, ALL, seeded(5))
    expect(o.grape!.map(x => x.value)).not.toContain('merlot')
  })

  it('gives vintage options in ascending order around the true year', () => {
    const o = buildOptions(chianti, ALL, seeded(6))
    const years = o.vintage!.map(x => Number(x.value))
    expect(years).toEqual([...years].sort((a, b) => a - b))
    expect(years).toContain(2019)
    expect(years.length).toBe(OPTION_COUNTS.vintage)
  })

  it('does not put the true vintage in the same slot every time', () => {
    const positions = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map(seed => {
        const o = buildOptions(chianti, ALL, seeded(seed))
        return o.vintage!.findIndex(x => x.value === '2019')
      }),
    )
    expect(positions.size).toBeGreaterThan(1)
  })

  it('never makes a blind guess profitable: every multiplier fits its button count', () => {
    // Betting A chips on a uniform guess returns A*(m - n)/n, so m > n pays
    // ignorance better than knowledge. This invariant is the whole reason
    // region has 8 buttons and vintage has 10.
    for (const cat of DEFAULT_CATEGORIES) {
      expect(cat.multiplier).toBeLessThanOrEqual(OPTION_COUNTS[cat.key])
    }
  })

  it('treats an off-canon style as missing instead of posting an unwinnable board', () => {
    const offDry: WineFacts = { ...chianti, style: 'off-dry' }
    expect(buildOptions(offDry, ALL, seeded(11)).style).toBeUndefined()
  })

  it('never offers a vintage that has not happened yet', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const o = buildOptions({ ...chianti, vintage: 2025 }, ALL, seeded(seed), 2026)
      for (const opt of o.vintage!) {
        expect(Number(opt.value)).toBeLessThanOrEqual(2026)
      }
      expect(o.vintage!.map(x => x.value)).toContain('2025')
    }
  })

  it('skips the vintage category for a wine from the current year', () => {
    // Only one legal window exists for a current-year wine, so the answer would
    // always sit on the last button. A year older and the window can move again.
    expect(buildOptions({ ...chianti, vintage: 2026 }, ALL, seeded(3), 2026).vintage).toBeUndefined()
    expect(buildOptions({ ...chianti, vintage: 2025 }, ALL, seeded(3), 2026).vintage)
      .toHaveLength(OPTION_COUNTS.vintage)
  })

  it('skips a category whose fact is missing', () => {
    const noRegion: WineFacts = { ...chianti, region: null, vintage: null }
    const o = buildOptions(noRegion, ALL, seeded(7))
    expect(o.region).toBeUndefined()
    expect(o.vintage).toBeUndefined()
    expect(o.country).toBeDefined()
  })

  it('skips a category the game has turned off', () => {
    const o = buildOptions(chianti, ['style', 'country'], seeded(8))
    expect(o.grape).toBeUndefined()
    expect(o.vintage).toBeUndefined()
    expect(o.style).toBeDefined()
    expect(o.country).toBeDefined()
  })

  it('treats orange wine as white for grape decoys and still fills the board', () => {
    const orange: WineFacts = { ...chianti, grape: 'Rkatsiteli', color: 'orange', country: 'Georgia', region: 'Kakheti' }
    const o = buildOptions(orange, ALL, seeded(9))
    expect(o.grape!.length).toBe(OPTION_COUNTS.grape)
  })
})
