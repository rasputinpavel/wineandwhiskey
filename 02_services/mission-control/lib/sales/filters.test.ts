import { describe, it, expect } from 'vitest'
import { priceIndicator, passesPostFilters, rejectReason } from './filters'
import type { ApifyPlaceItem } from './types'

const place = (over: Partial<ApifyPlaceItem> = {}): ApifyPlaceItem => ({
  placeId: 'p1', title: 'Test', reviewsCount: 100, ...over,
})

describe('priceIndicator', () => {
  it('reads the $-level indicator', () => {
    expect(priceIndicator('$$')).toBe('$$')
    expect(priceIndicator('$$$$')).toBe('$$$$')
  })
  it('is null for per-person brackets and blanks', () => {
    expect(priceIndicator('$18')).toBeNull()
    expect(priceIndicator('$10–20')).toBeNull()
    expect(priceIndicator('')).toBeNull()
    expect(priceIndicator(undefined)).toBeNull()
  })
})

describe('post filters', () => {
  const filter = { min_reviews: 50, price_levels: ['$$', '$$$'] }

  it('drops closed places', () => {
    expect(rejectReason(place({ permanentlyClosed: true }), filter)).toBe('closed')
    expect(rejectReason(place({ temporarilyClosed: true }), filter)).toBe('closed')
  })

  it('drops places below the reviews threshold', () => {
    expect(rejectReason(place({ reviewsCount: 12 }), filter)).toBe('reviews')
    expect(passesPostFilters(place({ reviewsCount: 50 }), filter)).toBe(true)
  })

  it('drops places whose known price level is not wanted', () => {
    expect(rejectReason(place({ price: '$' }), filter)).toBe('price')
    expect(passesPostFilters(place({ price: '$$$' }), filter)).toBe(true)
  })

  // The bug that made every Phuket scrape import zero leads: Google rarely
  // publishes a $-level there, and "unknown" was treated as "doesn't match".
  it('keeps places with no price level when a price filter is set', () => {
    expect(passesPostFilters(place({ price: undefined }), filter)).toBe(true)
    expect(passesPostFilters(place({ price: '' }), filter)).toBe(true)
    expect(passesPostFilters(place({ price: '$18' }), filter)).toBe(true)
  })

  it('ignores the price rule when no levels are selected', () => {
    expect(passesPostFilters(place({ price: '$' }), { min_reviews: 0, price_levels: [] })).toBe(true)
  })
})
