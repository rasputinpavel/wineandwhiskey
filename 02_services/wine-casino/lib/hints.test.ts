import { describe, it, expect } from 'vitest'
import { buildHints, hintTimes } from './hints'
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

describe('hintTimes', () => {
  it('uses the reference schedule for a 120-second round', () => {
    expect(hintTimes('easy', 120)).toEqual([90, 60, 30])
    expect(hintTimes('medium', 120)).toEqual([60, 25])
    expect(hintTimes('hard', 120)).toEqual([25])
    expect(hintTimes('pro', 120)).toEqual([])
  })

  it('scales proportionally for a shorter round', () => {
    expect(hintTimes('easy', 60)).toEqual([45, 30, 15])
  })

  it('never schedules a hint closer than 5 seconds to the buzzer', () => {
    expect(hintTimes('easy', 10).every(t => t >= 5)).toBe(true)
  })

  it('counts down — later hints have fewer seconds remaining', () => {
    const t = hintTimes('easy', 120)
    expect(t).toEqual([...t].sort((a, b) => b - a))
  })
})

describe('buildHints', () => {
  it('gives professionals nothing', () => {
    expect(buildHints(chianti, 'pro', 120, ALL)).toEqual([])
  })

  it('gives three hints on easy, at the scheduled times', () => {
    const hints = buildHints(chianti, 'easy', 120, ALL)
    expect(hints).toHaveLength(3)
    expect(hints.map(h => h.at)).toEqual([90, 60, 30])
  })

  it('opens with the vaguest hint — Old or New World', () => {
    const [first] = buildHints(chianti, 'easy', 120, ALL)
    expect(first.ru).toBe('Это Старый Свет')
    expect(first.en).toBe('This is the Old World')
  })

  it('narrows the vintage to a one-year window either side', () => {
    const hints = buildHints(chianti, 'easy', 120, ALL)
    const vintage = hints.find(h => h.ru.startsWith('Год'))!
    expect(vintage.ru).toBe('Год между 2018 и 2020')
    expect(vintage.en).toBe('Vintage between 2018 and 2020')
  })

  it('writes every hint in both languages', () => {
    for (const h of buildHints(chianti, 'easy', 120, ALL)) {
      expect(h.ru.length).toBeGreaterThan(0)
      expect(h.en.length).toBeGreaterThan(0)
    }
  })

  it('never hints at a category the game has turned off', () => {
    const hints = buildHints(chianti, 'easy', 120, ['country', 'style'])
    expect(hints.some(h => h.ru.startsWith('Год'))).toBe(false)
    expect(hints.some(h => h.ru === 'Это Старый Свет')).toBe(false)
  })

  it('skips generators whose fact is missing and still fills the earlier slots', () => {
    const bare: WineFacts = { ...chianti, vintage: null, region: null, grape: null }
    const hints = buildHints(bare, 'easy', 120, ALL)
    expect(hints.length).toBeGreaterThan(0)
    expect(hints.map(h => h.at)).toEqual([90, 60, 30].slice(0, hints.length))
  })

  it('never claims a colour for a grape we do not know on a bottle with no colour', () => {
    const kisi: WineFacts = { ...chianti, grape: 'Kisi', color: null }
    const hints = buildHints(kisi, 'easy', 120, ALL)
    expect(hints.some(h => h.ru === 'Сорт красный')).toBe(false)
    expect(hints.some(h => h.ru === 'Сорт белый')).toBe(false)
  })

  it('does name the colour when the bottle tells us, even for an unknown grape', () => {
    const kisi: WineFacts = { ...chianti, grape: 'Kisi', color: 'orange' }
    const hints = buildHints(kisi, 'easy', 120, ALL)
    expect(hints.some(h => h.ru === 'Сорт белый')).toBe(true)
  })

  it('returns nothing when no fact can produce a hint', () => {
    const blank: WineFacts = {
      name: 'Mystery', country: null, region: null, grape: null,
      vintage: null, style: null, color: null, abv: null,
    }
    expect(buildHints(blank, 'easy', 120, ALL)).toEqual([])
  })

  it('reveals the country initial in the local alphabet', () => {
    const hints = buildHints(chianti, 'easy', 120, ['country'])
    expect(hints[0].ru).toBe('Страна начинается на букву И')
    expect(hints[0].en).toBe('The country starts with I')
  })
})
