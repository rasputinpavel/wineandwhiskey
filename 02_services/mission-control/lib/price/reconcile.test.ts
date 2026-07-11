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

import { computeDiff } from './reconcile'
import type { WineItem } from './supabase'
import type { ExtractedItem } from './claude'

function active(partial: Partial<WineItem>): WineItem {
  return {
    id: partial.id ?? 'id-' + (partial.name ?? 'x'),
    price_list_id: 'pl-old', supplier_id: 's1', supplier_name: 'Harvest',
    name: partial.name ?? '', country: null, region: null, grape_variety: null,
    price: partial.price ?? null, year: partial.year ?? null,
    volume: partial.volume ?? '750ml', description: partial.description ?? null,
    image_url: null, vivino_rating: null, vivino_reviews_count: null, vivino_url: null,
    vivino_image_url: null, vivino_images: null, vivino_alcohol: null, vivino_body: null,
    vivino_flavors: null, vivino_food_pairings: null, vivino_region_hierarchy: null,
    vivino_style: null, vivino_year: null, vivino_enriched_at: null, winery: null,
    category: 'wine', wine_type: 'red', spirit_type: null, supplier_sku: null,
    status: partial.status ?? 'active', match_key: partial.match_key ?? null,
    discontinued_at: null, created_at: '2026-01-01',
  }
}
function parsed(partial: Partial<ExtractedItem>): ExtractedItem {
  return {
    name: partial.name ?? '', country: null, region: null, grape_variety: null,
    price: partial.price ?? null, year: partial.year ?? null,
    volume: partial.volume ?? '750ml', description: partial.description ?? null,
    category: 'wine', wine_type: 'red',
  }
}

describe('computeDiff', () => {
  it('flags an exact-match price change', () => {
    const existing = [active({ id: 'a', name: 'Cabernet Reserve', price: 300, volume: '750ml' })]
    const incoming = [parsed({ name: 'Cabernet Reserve 2020', price: 350, volume: '750ml' })]
    const d = computeDiff(existing, incoming)
    expect(d.changes).toHaveLength(1)
    expect(d.changes[0].kind).toBe('price_changed')
    expect(d.changes[0].existing_id).toBe('a')
    expect(d.changes[0].old_price).toBe(300)
    expect(d.changes[0].incoming?.price).toBe(350)
  })

  it('flags a new item as added', () => {
    const d = computeDiff([], [parsed({ name: 'Nude Saperavi', price: 590 })])
    expect(d.changes.map(c => c.kind)).toEqual(['added'])
  })

  it('flags a missing item as discontinued', () => {
    const existing = [active({ id: 'a', name: 'Old Wine' })]
    const d = computeDiff(existing, [])
    expect(d.changes[0].kind).toBe('discontinued')
    expect(d.changes[0].existing_id).toBe('a')
  })

  it('reactivates a discontinued item that reappears', () => {
    const existing = [active({ id: 'a', name: 'Grape Dance', status: 'discontinued', price: 500 })]
    const incoming = [parsed({ name: 'Grape Dance', price: 550 })]
    const d = computeDiff(existing, incoming)
    expect(d.changes[0].kind).toBe('reactivated')
  })

  it('marks matched-but-identical as unchanged and attr-only as updated', () => {
    const existing = [
      active({ id: 'u', name: 'Same', price: 100, description: 'old note' }),
      active({ id: 'v', name: 'Identical', price: 200, description: 'x' }),
    ]
    const incoming = [
      parsed({ name: 'Same', price: 100, description: 'new note' }),
      parsed({ name: 'Identical', price: 200, description: 'x' }),
    ]
    const d = computeDiff(existing, incoming)
    const byId = Object.fromEntries(d.changes.map(c => [c.existing_id, c.kind]))
    expect(byId['u']).toBe('updated')
    expect(byId['v']).toBe('unchanged')
  })

  it('surfaces a fuzzy-only match as ambiguous, not added+discontinued', () => {
    const existing = [active({ id: 'a', name: 'Cabernet Sauvignon Reserve', price: 300 })]
    const incoming = [parsed({ name: 'Cabernet Sauvignon Reserve Collection', price: 320 })]
    const d = computeDiff(existing, incoming)
    expect(d.changes.map(c => c.kind)).toContain('ambiguous')
    expect(d.changes.some(c => c.kind === 'added')).toBe(false)
    expect(d.changes.some(c => c.kind === 'discontinued')).toBe(false)
  })
})
