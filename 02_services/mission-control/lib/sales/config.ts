// Static knobs for the sales CRM module. Districts and business-kind presets
// are codified here so the scrape form, table filters, and PostgREST enums
// stay in sync.

export const PHUKET_DISTRICTS = [
  'Patong',
  'Karon',
  'Kata',
  'Rawai',
  'Nai Harn',
  'Chalong',
  'Phuket Town',
  'Cape Panwa',
  'Kamala',
  'Surin',
  'Bang Tao',
  'Cherngtalay',
  'Nai Yang',
  'Mai Khao',
  'Thalang',
] as const
export type District = (typeof PHUKET_DISTRICTS)[number]

export const BUSINESS_KINDS = ['restaurant', 'bar', 'hotel', 'tour', 'event', 'other'] as const
export type BusinessKind = (typeof BUSINESS_KINDS)[number]

export const BUSINESS_KIND_LABEL: Record<BusinessKind, string> = {
  restaurant: 'Restaurant',
  bar:        'Bar',
  hotel:      'Hotel',
  tour:       'Tour / Yacht',
  event:      'Event agency',
  other:      'Other',
}

// Search-term presets per business kind. User can edit before running scrape.
// We pass these as `searchStringsArray` to the actor; Apify queries Google Maps
// once per term and unions results.
//
// Start with a single broad term — fewer searches, more reliable. Add specifics
// only after the base case is confirmed working in Apify Console.
export const KIND_SEARCH_PRESETS: Record<BusinessKind, string[]> = {
  restaurant: ['restaurant'],
  bar:        ['bar'],
  hotel:      ['hotel'],
  tour:       ['yacht charter'],
  event:      ['event agency'],
  other:      [],
}

// Actor's `categoryFilterWords` — applied by Apify *server-side* to drop results
// whose Google category doesn't contain any of these strings. Default to EMPTY
// because:
//   1) the actor is happy without it and trusts the search term
//   2) any typo / case mismatch silently zeroes the dataset (false-negative trap)
// Fill it manually only after confirming the base scrape returns results.
export const KIND_CATEGORY_FILTER: Record<BusinessKind, string[]> = {
  restaurant: [],
  bar:        [],
  hotel:      [],
  tour:       [],
  event:      [],
  other:      [],
}

// Actor's `placeMinimumStars` enum — only these exact strings are valid.
// Anything else and the actor 400s.
export const MIN_STARS_OPTIONS = ['', 'two', 'twoAndHalf', 'three', 'threeAndHalf', 'four', 'fourAndHalf'] as const
export type MinStars = (typeof MIN_STARS_OPTIONS)[number]
export const MIN_STARS_LABEL: Record<MinStars, string> = {
  '':            'Any',
  'two':         '≥ 2',
  'twoAndHalf':  '≥ 2.5',
  'three':       '≥ 3',
  'threeAndHalf':'≥ 3.5',
  'four':        '≥ 4',
  'fourAndHalf': '≥ 4.5',
}

// Apify pricing for compass/crawler-google-places — used for "estimated cost"
// preview on the scrape form. Update if Apify changes pricing.
export const APIFY_USD_PER_PLACE = 0.0021
