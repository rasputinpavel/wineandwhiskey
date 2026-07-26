import { describe, it, expect } from 'vitest'
import { countryToFlag } from './flags'

describe('countryToFlag', () => {
  it('maps English names to flag emoji', () => {
    expect(countryToFlag('Italy')).toBe('🇮🇹')
    expect(countryToFlag('FRANCE')).toBe('🇫🇷')
    expect(countryToFlag('Russia')).toBe('🇷🇺')
    expect(countryToFlag('Moldova')).toBe('🇲🇩')
  })
  it('maps Russian names too', () => {
    expect(countryToFlag('Италия')).toBe('🇮🇹')
    expect(countryToFlag('Грузия')).toBe('🇬🇪')
  })
  it('handles subdivision flags (Scotland)', () => {
    expect(countryToFlag('Scotland')).toBe('🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}')
  })
  it('falls back to the globe for unknown/empty', () => {
    expect(countryToFlag('Atlantis')).toBe('🌍')
    expect(countryToFlag('')).toBe('🌍')
    expect(countryToFlag(null)).toBe('🌍')
    expect(countryToFlag(undefined)).toBe('🌍')
  })
})
