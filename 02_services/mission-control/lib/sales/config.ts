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
export const KIND_SEARCH_PRESETS: Record<BusinessKind, string[]> = {
  restaurant: ['restaurant', 'italian restaurant', 'thai restaurant', 'seafood restaurant', 'steakhouse'],
  bar:        ['bar', 'wine bar', 'cocktail bar', 'beach bar'],
  hotel:      ['hotel', 'resort', 'boutique hotel'],
  tour:       ['yacht charter', 'speedboat tour', 'private boat tour', 'luxury yacht'],
  event:      ['event agency', 'wedding planner', 'corporate events'],
  other:      [],
}

// Actor's `categoryFilterWords` — applied server-side by Apify to drop results
// that aren't of the requested type. Maps our internal kind → Google category labels.
export const KIND_CATEGORY_FILTER: Record<BusinessKind, string[]> = {
  restaurant: ['restaurant'],
  bar:        ['bar', 'pub', 'wine bar', 'cocktail bar'],
  hotel:      ['hotel', 'resort', 'lodging'],
  tour:       ['boat tour agency', 'yacht club', 'tour operator', 'travel agency'],
  event:      ['event planner', 'wedding planner', 'event management company'],
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
