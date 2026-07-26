import { describe, it, expect } from 'vitest'
import { zoneFromWineColor, zoneToken, PLAQUE_TOKENS, zoneFromCategory, inferZone } from './plaques'

describe('zoneFromWineColor', () => {
  it('maps direct colors', () => {
    expect(zoneFromWineColor('red')).toBe('red')
    expect(zoneFromWineColor('white')).toBe('white')
    expect(zoneFromWineColor('sparkling')).toBe('sparkling')
    expect(zoneFromWineColor('rose')).toBe('rose')
  })
  it('folds orange into the white zone (v1)', () => {
    expect(zoneFromWineColor('orange')).toBe('white')
  })
  it('defaults unknown/nullish to white', () => {
    expect(zoneFromWineColor(null)).toBe('white')
    expect(zoneFromWineColor(undefined)).toBe('white')
    expect(zoneFromWineColor('grape-juice')).toBe('white')
  })
})

describe('zoneToken', () => {
  it('returns the brand token hex per zone', () => {
    expect(zoneToken('red')).toBe(PLAQUE_TOKENS.red)
    expect(zoneToken('spirits')).toBe('#3D3D3D')
    expect(zoneToken('rose')).toBe('#C98C8C')
  })
})

describe('zoneFromCategory', () => {
  it('maps wine categories', () => {
    expect(zoneFromCategory('Red Wine')).toBe('red')
    expect(zoneFromCategory('White Wine')).toBe('white')
    expect(zoneFromCategory('Sparkling Wine')).toBe('sparkling')
    expect(zoneFromCategory('Pét-Nat')).toBe('sparkling')
    expect(zoneFromCategory('Rose Wine')).toBe('rose')
    expect(zoneFromCategory('Orange Wine')).toBe('white')
  })
  it('maps spirit categories via hint', () => {
    expect(zoneFromCategory('Whiskey')).toBe('spirits')
    expect(zoneFromCategory('Rum')).toBe('spirits')
    expect(zoneFromCategory('Cognac Armagnac')).toBe('spirits')
    expect(zoneFromCategory('GIN')).toBe('spirits')
  })
  it('returns null for non-wine / unknown so caller falls back', () => {
    expect(zoneFromCategory('Food')).toBeNull()
    expect(zoneFromCategory('Cigar')).toBeNull()
    expect(zoneFromCategory(null)).toBeNull()
  })
})

describe('inferZone — wine_color wins, else category, else white', () => {
  it('uses a curated wine_color when present', () => {
    expect(inferZone('sparkling', 'Red Wine')).toBe('sparkling')
  })
  it('falls back to category when wine_color is null', () => {
    expect(inferZone(null, 'Red Wine')).toBe('red')     // the Ed Knows Cabernet/Merlot case
    expect(inferZone(null, 'White Wine')).toBe('white')
    expect(inferZone(null, 'Whiskey')).toBe('spirits')
  })
  it('defaults to white when neither is known', () => {
    expect(inferZone(null, 'Food')).toBe('white')
    expect(inferZone(null, null)).toBe('white')
  })
})
