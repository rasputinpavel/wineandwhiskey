// Post-filters applied to Apify place items on import.
//
// Apify's actor-side filter handles rating, but reviews count and price level
// it either ignores or applies unreliably, so we redo them here. Kept pure and
// separate from the route so the rules can be tested — they decide whether a
// paid scrape turns into leads or into an empty import.

import type { ApifyPlaceItem, ScrapeInput } from './types'

// Google's price *indicator* is the "$".."$$$$" string. The same field also
// carries per-person brackets ("$18", "$10–20"), and for most Phuket places
// it's simply absent. Only the indicator form is a level we can filter on.
export function priceIndicator(price?: string | null): string | null {
  if (!price) return null
  const m = price.trim().match(/^\$+$/)
  return m ? m[0] : null
}

export type RejectReason = 'closed' | 'reviews' | 'price'

// Why a place was dropped, or null if it passes.
// Price rule: no indicator = unknown, and unknown is not a rejection. Google
// reports the $-level for a small minority of Thai listings, so rejecting on
// a missing value threw away every single place (see the 2026-05 and
// 2026-09-14 runs — rejected == scraped).
export function rejectReason(
  p: ApifyPlaceItem,
  input: Pick<ScrapeInput, 'min_reviews' | 'price_levels'>,
): RejectReason | null {
  if (p.permanentlyClosed || p.temporarilyClosed) return 'closed'
  if ((p.reviewsCount ?? 0) < (input.min_reviews ?? 0)) return 'reviews'
  const wanted = input.price_levels ?? []
  if (wanted.length > 0) {
    const lvl = priceIndicator(p.price)
    if (lvl && !wanted.includes(lvl)) return 'price'
  }
  return null
}

export function passesPostFilters(
  p: ApifyPlaceItem,
  input: Pick<ScrapeInput, 'min_reviews' | 'price_levels'>,
): boolean {
  return rejectReason(p, input) === null
}
