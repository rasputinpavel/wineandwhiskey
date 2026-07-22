import { describe, it, expect } from 'vitest'
import { detectVariant, toIntPrice, isSMD } from './smd'

describe('detectVariant', () => {
  it('returns gcc1855 from the GCC filename', () => {
    expect(detectVariant('SMD_BROCHURE_GCC1855.pdf', '')).toBe('gcc1855')
  })
  it('returns gcc1855 from first-page text when filename is neutral', () => {
    expect(detectVariant('catalog.pdf', 'GRAND CRU CLASSÉ 1855 THE COMPLETE COLLECTION')).toBe('gcc1855')
  })
  it('defaults to wine', () => {
    expect(detectVariant('SMD_BROCHURE_WINE_JUL26.pdf', 'DARK HORSE POURING')).toBe('wine')
  })
})

describe('toIntPrice', () => {
  it('strips thousands separators to an integer', () => {
    expect(toIntPrice('9,400')).toBe(9400)
    expect(toIntPrice('410')).toBe(410)
  })
  it('rounds numbers and rejects junk', () => {
    expect(toIntPrice(360.4)).toBe(360)
    expect(toIntPrice('N/A')).toBeNull()
    expect(toIntPrice(null)).toBeNull()
  })
})

describe('isSMD', () => {
  it('matches on filename without reading the PDF', async () => {
    expect(await isSMD(Buffer.from(''), 'SMD_BROCHURE_WINE_JUL26.pdf')).toBe(true)
    expect(await isSMD(Buffer.from(''), 'gcc1855.pdf')).toBe(true)
  })
  it('returns false for a non-SMD filename with no readable PDF', async () => {
    expect(await isSMD(Buffer.from(''), 'random-supplier.pdf')).toBe(false)
  })
})
