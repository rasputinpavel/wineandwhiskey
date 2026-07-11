import { describe, it, expect } from 'vitest'
import { normalizeName, canonicalVolume, matchKey } from './reconcile'

describe('normalizeName', () => {
  it('lowercases, strips punctuation & diacritics, collapses spaces', () => {
    expect(normalizeName('Château  Tamagne, Réserve!')).toBe('chateau tamagne reserve')
  })
  it('drops 4-digit vintage year tokens', () => {
    expect(normalizeName('Cabernet Reserve 2016')).toBe('cabernet reserve')
    expect(normalizeName('Brut d’Or Riesling 2021')).toBe('brut dor riesling')
  })
})

describe('canonicalVolume', () => {
  it('canonicalizes ml / L notations to a bare number of ml', () => {
    expect(canonicalVolume('750ml')).toBe('750')
    expect(canonicalVolume('0.75 L')).toBe('750')
    expect(canonicalVolume('187 ml')).toBe('187')
  })
  it('returns "750" for null/empty (bottle default)', () => {
    expect(canonicalVolume(null)).toBe('750')
    expect(canonicalVolume('')).toBe('750')
  })
})

describe('matchKey', () => {
  it('joins normalized name and canonical volume, year-agnostic', () => {
    expect(matchKey('Cabernet Reserve 2016', '750ml')).toBe('cabernet reserve|750')
    expect(matchKey('Cabernet Reserve 2020', '0.75L')).toBe('cabernet reserve|750')
  })
})
