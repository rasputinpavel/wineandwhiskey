import { describe, it, expect } from 'vitest'
import { COUNTRIES, GRAPES, countryOption, grapeGroup, grapeOption, regionsFor } from './wine-data'

describe('the dictionaries themselves', () => {
  it('keeps every value canonical, because answers are matched by trim().toLowerCase()', () => {
    for (const o of [...COUNTRIES, ...GRAPES]) {
      expect(o.value).toBe(o.value.trim().toLowerCase())
    }
  })

  it('has no duplicate country or grape', () => {
    expect(new Set(COUNTRIES.map(c => c.value)).size).toBe(COUNTRIES.length)
    expect(new Set(GRAPES.map(g => g.value)).size).toBe(GRAPES.length)
  })

  it('has enough grapes of each colour to fill a six-button board', () => {
    expect(GRAPES.filter(g => g.group === 'red').length).toBeGreaterThanOrEqual(6)
    expect(GRAPES.filter(g => g.group === 'white').length).toBeGreaterThanOrEqual(6)
  })
})

describe('countryOption', () => {
  it('matches regardless of case and padding', () => {
    expect(countryOption('  ITALY ').value).toBe('italy')
  })

  it('round-trips the answer key that prepareWine will store', () => {
    for (const raw of ['Italy', 'georgia', ' Cyprus ', 'Thailand']) {
      expect(countryOption(raw).value).toBe(raw.trim().toLowerCase())
    }
  })

  it('falls back to the raw name for a country we do not stock', () => {
    const o = countryOption('Freedonia')
    expect(o.value).toBe('freedonia')
    expect(o.en).toBe('Freedonia')
  })
})

describe('grapeOption', () => {
  it('finds a known grape and keeps its colour', () => {
    expect(grapeOption('Merlot').group).toBe('red')
    expect(grapeOption('riesling').group).toBe('white')
  })

  it('takes the colour from the bottle for a grape outside the pool', () => {
    // Kisi is a Georgian amber grape we actually stock.
    expect(grapeOption('Kisi', 'orange').group).toBe('white')
    expect(grapeOption('Kisi', 'red').group).toBe('red')
  })

  it('refuses to invent a colour when both grape and bottle are unknown', () => {
    expect(grapeOption('Kisi').group).toBeNull()
    expect(grapeOption('Kisi', null).group).toBeNull()
  })

  it('round-trips the answer key', () => {
    expect(grapeOption('  Saperavi ').value).toBe('saperavi')
  })
})

describe('grapeGroup', () => {
  it('pairs rose with red grapes and orange with white', () => {
    expect(grapeGroup('rose')).toBe('red')
    expect(grapeGroup('orange')).toBe('white')
  })

  it('returns null for an unknown colour so the caller can widen the pool', () => {
    expect(grapeGroup(null)).toBeNull()
  })
})

describe('regionsFor', () => {
  it('uses the country own regions when it has enough', () => {
    const values = regionsFor('Italy').map(r => r.value)
    expect(values).toContain('toscana')
    expect(values).not.toContain('rioja')
  })

  it('fills an eight-button board from every country we stock, without borrowing', () => {
    for (const c of COUNTRIES) {
      expect(regionsFor(c.value).length).toBeGreaterThanOrEqual(8)
    }
    // Borrowing shows up as another country's region in the pool. If Georgia or
    // Thailand had fewer than eight of their own, Bordeaux and Rioja would leak
    // in as decoys, and a guest could discard them on sight for a x8 payout.
    expect(regionsFor('Georgia').map(r => r.value)).not.toContain('bordeaux')
    expect(regionsFor('Thailand').map(r => r.value)).not.toContain('rioja')
  })

  it('still widens the pool for a country we have not catalogued at all', () => {
    expect(regionsFor('Freedonia').length).toBeGreaterThanOrEqual(8)
  })

  it('lowercases values so they match the stored answer', () => {
    for (const r of regionsFor('Georgia')) {
      expect(r.value).toBe(r.ru.trim().toLowerCase())
    }
  })
})
