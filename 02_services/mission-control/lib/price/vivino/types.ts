export type VivinoGrape = string | { name: string }

type NamedRef = string | { name?: string }

export type VivinoResult = {
  searchQuery?: string
  average_rating?: number
  ratings_count?: number
  image_url?: string | string[]
  images?: string[]
  vivino_url?: string

  // Actor's real field names (verified 2026-04-30 against
  // mrbridge~vivino-wine-data-scraper).
  grape_varieties?: NamedRef[]   // canonical
  grapes?: VivinoGrape[]         // legacy / alt name kept for tolerance

  winery?: NamedRef
  wine_type?: string             // "Red" | "White" | "Sparkling" | "Rosé"
  wine_type_id?: number          // legacy
  type?: string                  // legacy

  name?: string

  region?: NamedRef
  subregion?: NamedRef
  appellation?: NamedRef
  country?: NamedRef

  vintage?: number | string
  year?: number | string
  alcohol?: number | string
  abv?: number | string

  style?: NamedRef
  body?: string | number
  flavors?: NamedRef[]
  flavor_profile?: { flavors?: NamedRef[] } | NamedRef[]
  taste_profile?: {
    body?: number
    acidity?: number
    tannins?: number
    sweetness?: number
    fizziness?: number | null
    flavor_notes?: string[]
    flavors?: NamedRef[]         // legacy alias if actor changes
  } & Record<string, unknown>

  food_pairings?: NamedRef[]
  food_pairing?: NamedRef[]

  [key: string]: unknown
}

export const VIVINO_BODY_BUCKETS: Record<number, 'light' | 'medium' | 'full'> = {
  1: 'light', 2: 'light',
  3: 'medium',
  4: 'full', 5: 'full',
}

export const VIVINO_WINE_TYPES: Record<number, 'red' | 'white' | 'sparkling' | 'rose'> = {
  1: 'red',
  2: 'white',
  3: 'sparkling',
  4: 'rose',
}

export type WineItemRow = {
  id: string
  name: string
  grape_variety: string | null
  winery: string | null
  wine_type: string | null
  country: string | null
  region: string | null
  year: number | null
}
