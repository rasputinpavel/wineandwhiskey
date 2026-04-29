export type VivinoGrape = string | { name: string }

type NamedRef = string | { name?: string }

export type VivinoResult = {
  searchQuery?: string
  average_rating?: number
  ratings_count?: number
  image_url?: string | string[]
  images?: string[]
  vivino_url?: string
  grapes?: VivinoGrape[]
  winery?: NamedRef
  wine_type_id?: number
  type?: string
  name?: string

  // Region / geography
  region?: NamedRef
  subregion?: NamedRef
  appellation?: NamedRef
  country?: NamedRef

  // Vintage / chemistry
  vintage?: number | string
  year?: number | string
  alcohol?: number | string
  abv?: number | string

  // Style / taste
  style?: NamedRef
  body?: string | number
  flavors?: NamedRef[]
  flavor_profile?: { flavors?: NamedRef[] } | NamedRef[]
  taste_profile?: Record<string, unknown>

  // Food pairings
  food_pairings?: NamedRef[]
  food_pairing?: NamedRef[]

  // Generic catch-all so we don't blow up on unknown shapes.
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
