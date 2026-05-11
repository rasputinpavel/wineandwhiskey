// Static knobs for the sales CRM module. Districts and business-kind presets
// are codified here so the scrape form, table filters, and PostgREST enums
// stay in sync.

// Phuket districts with explicit centre+radius. We feed these to Apify via
// `customGeolocation` (auto-built polygon below) instead of `locationQuery`,
// because Nominatim mangles short names: "Kata, Phuket, Thailand" resolves
// to "Ko Katha" — a 0.04 km² island with zero restaurants. Same for "Surin"
// (a province in NE Thailand) etc. Hard-coded coords bypass that entirely.
export const PHUKET_DISTRICT_GEO = {
  'Patong':       { lat: 7.8961, lng: 98.2966, radiusKm: 3 },
  'Karon':        { lat: 7.8475, lng: 98.2981, radiusKm: 3 },
  'Kata':         { lat: 7.8167, lng: 98.2992, radiusKm: 2.5 },
  'Rawai':        { lat: 7.7831, lng: 98.3261, radiusKm: 2 },
  'Nai Harn':     { lat: 7.7806, lng: 98.3033, radiusKm: 1.5 },
  'Chalong':      { lat: 7.8467, lng: 98.3417, radiusKm: 2 },
  'Phuket Town':  { lat: 7.8845, lng: 98.3877, radiusKm: 3 },
  'Cape Panwa':   { lat: 7.8047, lng: 98.4061, radiusKm: 2 },
  'Kamala':       { lat: 7.9531, lng: 98.2845, radiusKm: 2 },
  'Surin':        { lat: 7.9758, lng: 98.2789, radiusKm: 2 },
  'Bang Tao':     { lat: 8.0093, lng: 98.2967, radiusKm: 2.5 },
  'Cherngtalay':  { lat: 8.0028, lng: 98.3014, radiusKm: 3 },
  'Nai Yang':     { lat: 8.0850, lng: 98.2934, radiusKm: 2 },
  'Mai Khao':     { lat: 8.1583, lng: 98.3056, radiusKm: 3 },
  'Thalang':      { lat: 8.0494, lng: 98.3567, radiusKm: 4 },
} as const
export const PHUKET_DISTRICTS = Object.keys(PHUKET_DISTRICT_GEO) as Array<keyof typeof PHUKET_DISTRICT_GEO>
export type District = keyof typeof PHUKET_DISTRICT_GEO

// Approximate a circle as a 16-vertex polygon (GeoJSON outer ring). Apify's
// actor accepts customGeolocation as a Polygon — Point+radius isn't supported.
// Equirectangular projection is fine for ≤5km circles at Phuket's latitude.
export function circleToPolygon(lat: number, lng: number, radiusKm: number, vertices = 16): number[][][] {
  const ring: number[][] = []
  const dLatPerKm = 1 / 111.32
  const dLngPerKm = 1 / (111.32 * Math.cos((lat * Math.PI) / 180))
  for (let i = 0; i <= vertices; i++) {
    const angle = (i / vertices) * 2 * Math.PI
    ring.push([
      lng + radiusKm * dLngPerKm * Math.sin(angle),
      lat + radiusKm * dLatPerKm * Math.cos(angle),
    ])
  }
  return [ring]
}

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
