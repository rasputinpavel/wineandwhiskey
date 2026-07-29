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
  it('separates Champagne from Sparkling', () => {
    expect(zoneFromCategory('Champagne')).toBe('champagne')
    expect(zoneFromCategory('Sparkling Wine')).toBe('sparkling')
  })
})

describe('inferZone — Champagne is its own type', () => {
  it('routes a Champagne name to the champagne zone (before generic brut/sparkling)', () => {
    expect(inferZone(null, 'RUSSIA', 'Moët & Chandon Brut Impérial Champagne')).toBe('champagne')
  })
  it('a non-Champagne brut stays sparkling', () => {
    expect(inferZone(null, 'RUSSIA', 'Abrau Durso Brut')).toBe('sparkling')
  })
})

describe('inferZone — wine_color wins, else category, else name, else white', () => {
  it('uses a curated wine_color when present', () => {
    expect(inferZone('sparkling', 'Red Wine')).toBe('sparkling')
  })
  it('falls back to category when wine_color is null', () => {
    expect(inferZone(null, 'Red Wine')).toBe('red')     // the Ed Knows Cabernet/Merlot case
    expect(inferZone(null, 'White Wine')).toBe('white')
    expect(inferZone(null, 'Whiskey')).toBe('spirits')
  })
  it('falls back to the NAME for sparkling/grape when category is non-colour (e.g. "RUSSIA")', () => {
    // the Abrau-Durso case: category "RUSSIA", no wine_color
    expect(inferZone(null, 'RUSSIA', 'Abrau Durso Victor Dravigny Premium Brut White')).toBe('sparkling')
    expect(inferZone(null, 'RUSSIA', 'Abrau-Durso "Brut d\'Or" Riesling 2021')).toBe('sparkling')
    expect(inferZone(null, 'RUSSIA', 'Abrau Durso Pinot Noir')).toBe('red')
    expect(inferZone(null, 'RUSSIA', 'Abrau Durso Chardonnay')).toBe('white')
  })
  it('treats Blanc de Noirs as white despite the red grape', () => {
    expect(inferZone(null, null, 'Blanc de Noirs')).toBe('white')
  })
  it('defaults to white when nothing is known', () => {
    expect(inferZone(null, 'Food', 'Some Mystery Bottle')).toBe('white')
    expect(inferZone(null, null, null)).toBe('white')
  })
})
