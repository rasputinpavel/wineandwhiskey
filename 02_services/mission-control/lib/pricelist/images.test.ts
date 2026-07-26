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
    expect(imageKey('Alamos Malbec Red Wine 2021 750ml')).toBe(imageKey('Alamos Malbec'))
  })
  it('does NOT equate a rosé with its non-rosé sibling', () => {
    expect(imageKey('Abrau Durso Reserve Brut')).not.toBe(imageKey('Abrau Durso Reserve ROSE Brut'))
  })
})
