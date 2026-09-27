import { describe, it, expect } from 'vitest'
import { DEFAULT_CATEGORIES, STYLE_OPTIONS, WORLD_OPTIONS, worldOf } from './categories'

describe('worldOf', () => {
  it('puts Georgia and Russia in the Old World', () => {
    expect(worldOf('Georgia')).toBe('old')
    expect(worldOf('Russia')).toBe('old')
  })

  it('puts Chile and New Zealand in the New World', () => {
    expect(worldOf('Chile')).toBe('new')
    expect(worldOf('New Zealand')).toBe('new')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(worldOf('  ITALY ')).toBe('old')
  })

  it('returns null when the country is unknown, so the category can be skipped', () => {
    expect(worldOf(null)).toBeNull()
    expect(worldOf('   ')).toBeNull()
  })

  it('treats a country outside the Old World list as New World', () => {
    expect(worldOf('Thailand')).toBe('new')
  })
})

describe('DEFAULT_CATEGORIES', () => {
  it('pays more for harder questions, vintage highest', () => {
    const byKey = Object.fromEntries(DEFAULT_CATEGORIES.map(c => [c.key, c.multiplier]))
    expect(byKey.style).toBeLessThan(byKey.world)
    expect(byKey.world).toBeLessThan(byKey.country)
    expect(byKey.country).toBeLessThan(byKey.grape)
    expect(byKey.grape).toBeLessThan(byKey.region)
    expect(byKey.region).toBeLessThan(byKey.vintage)
  })

  it('has no duplicate keys', () => {
    const keys = DEFAULT_CATEGORIES.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('fixed option lists', () => {
  it('offers four styles ordered dry to sweet', () => {
    expect(STYLE_OPTIONS.map(o => o.value)).toEqual(['dry', 'semi-dry', 'semi-sweet', 'sweet'])
  })

  it('offers exactly two worlds', () => {
    expect(WORLD_OPTIONS.map(o => o.value)).toEqual(['old', 'new'])
  })
})
