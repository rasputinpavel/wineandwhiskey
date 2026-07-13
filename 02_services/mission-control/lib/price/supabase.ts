// Supabase access for the price-list domain.
//
// Re-exports the shared `sbPublic` client from ../supabase under the name
// `supabase` so the parsers / vivino code copied from the old price-service
// keeps its existing import shape (`import { supabase } from '@/lib/price/supabase'`).
//
// Domain types live here because they're price-specific. Note: there is also
// a `Supplier` type in ../supabase for the inventory schema — they are
// different shapes and must not be conflated.

export { sbPublic as supabase } from '../supabase'

export type Supplier = {
  id: string
  name: string
  slug: string
  created_at: string
}

export type PriceList = {
  id: string
  supplier_id: string | null
  supplier_name: string | null
  date: string | null
  pdf_url: string | null
  status: 'pending' | 'processing' | 'review' | 'done' | 'error'
  item_count: number
  error_message: string | null
  uploaded_at: string
}

export type WineItem = {
  id: string
  price_list_id: string
  supplier_id: string | null
  supplier_name: string | null
  name: string
  country: string | null
  region: string | null
  grape_variety: string | null
  price: number | null
  year: number | null
  volume: string | null
  description: string | null
  image_url: string | null
  vivino_rating: number | null
  vivino_reviews_count: number | null
  vivino_url: string | null
  vivino_image_url: string | null
  vivino_images: string[] | null
  vivino_alcohol: number | null
  vivino_body: string | null
  vivino_flavors: string[] | null
  vivino_food_pairings: string[] | null
  vivino_region_hierarchy: { country: string | null; region: string | null; subregion: string | null; appellation: string | null } | null
  vivino_style: string | null
  vivino_year: number | null
  vivino_enriched_at: string | null
  winery: string | null
  category: 'wine' | 'spirits' | 'beer' | 'other' | null
  wine_type: 'red' | 'white' | 'rose' | 'orange' | 'sparkling' | null
  spirit_type: string | null
  supplier_sku: string | null
  status: 'active' | 'discontinued'
  match_key: string | null
  discontinued_at: string | null
  created_at: string
  // Derived at query time (catalog freshness), not a DB column.
  catalog_status?: 'current' | 'expired' | null
}

export type CatalogUpdate = {
  id: string
  supplier_id: string | null
  new_price_list_id: string | null
  status: 'pending_review' | 'applied' | 'discarded'
  diff: import('./reconcile').CatalogDiff
  created_at: string
  applied_at: string | null
}
