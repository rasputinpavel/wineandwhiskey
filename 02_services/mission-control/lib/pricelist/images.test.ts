import { describe, it, expect } from 'vitest'
import { slugify, imageKey } from './images'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Abrau-Durso Chardonnay')).toBe('abrau-durso-chardonnay')
    expect(slugify('Château Tamagne  DUO Blanc')).toBe('chateau-tamagne-duo-blanc')
  })
})

describe('imageKey — order/stopword-independent signature', () => {
  it('is stable across word order and separators', () => {
    expect(imageKey('Abrau Durso Chardonnay')).toBe(imageKey('abrau-durso-chardonnay'))
    expect(imageKey('Chardonnay Abrau Durso')).toBe(imageKey('Abrau Durso Chardonnay'))
  })
  it('ignores stopwords, vintages and volumes', () => {
    expect(imageKey('Alamos Malbec Wine 2021 750ml')).toBe(imageKey('Alamos Malbec'))
  })
  it('keeps colour words significant (never conflate a red with a white/rosé)', () => {
    // "red"/"white"/"blanc" distinguish siblings of the same line, so they stay.
    expect(imageKey('Chateau Tamagne Duo Blanc')).not.toBe(imageKey('Chateau Tamagne Duo Red'))
    expect(imageKey('Abrau Durso Reserve Brut')).not.toBe(imageKey('Abrau Durso Reserve ROSE Brut'))
  })
})
