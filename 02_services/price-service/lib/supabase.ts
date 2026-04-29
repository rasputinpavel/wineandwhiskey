import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_KEY!

export const supabase = createClient(url, key)

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
  status: 'pending' | 'processing' | 'done' | 'error'
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
  created_at: string
}
