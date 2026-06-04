import 'server-only'
import { sbInventory, sbPublic } from './supabase'
import type { WineCard, WineColor } from './types'

// Strip vintages/volumes so "Errazuriz Estate Chardonnay 2021 750ml" matches
// "Errazuriz Estate Chardonnay" in wine_items. Same approach as mission-control's
// wine-matrix/queries.ts.
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(l|ml|cl)\b/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

type SkuRow = {
  sku_id: string
  loyverse_product_code: string | null
  name: string
  wine_color: WineColor | null
  grape_variety: string | null
  wine_country: string | null
  default_price: number | null
  on_hand: number
}

type WineItemRow = {
  name: string
  winery: string | null
  vivino_image_url: string | null
  image_url: string | null
  vivino_rating: number | null
  vivino_url: string | null
  description: string | null
  vivino_food_pairings: string[] | null
  vivino_body: string | null
}

let cache: { at: number; data: WineCard[] } | null = null
const CACHE_TTL_MS = 60_000  // refresh every minute, plenty for kiosk

export async function listInStock(): Promise<WineCard[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data

  const { data: skus, error } = await sbInventory
    .from('v_sku_breakdown')
    .select('sku_id,loyverse_product_code,name,wine_color,grape_variety,wine_country,default_price,on_hand')
    .gt('on_hand', 0)
    .not('wine_color', 'is', null)
  if (error) throw error

  const stock = (skus ?? []) as SkuRow[]

  // Bulk-fetch Vivino-enriched rows, then match by normalized name. We don't
  // have a SKU join in wine_items so this is best-effort name matching.
  const { data: items } = await sbPublic
    .from('wine_items')
    .select('name,winery,vivino_image_url,image_url,vivino_rating,vivino_url,description,vivino_food_pairings,vivino_body')
  const byName = new Map<string, WineItemRow>()
  for (const w of (items ?? []) as WineItemRow[]) {
    const k = normName(w.name)
    if (k && !byName.has(k)) byName.set(k, w)
  }

  const out: WineCard[] = stock.map(s => {
    const w = byName.get(normName(s.name))
    return {
      id:            s.sku_id,
      code:          s.loyverse_product_code,
      name:          s.name,
      color:         s.wine_color,
      grape:         s.grape_variety,
      country:       s.wine_country,
      winery:        w?.winery ?? null,
      price_thb:     s.default_price != null ? Number(s.default_price) : null,
      qty:           Number(s.on_hand) || 0,
      image_url:     w?.vivino_image_url ?? w?.image_url ?? null,
      vivino_rating: w?.vivino_rating ?? null,
      vivino_url:    w?.vivino_url ?? null,
      description:   w?.description ?? null,
      food_pairings: w?.vivino_food_pairings ?? [],
      body:          w?.vivino_body ?? null,
    }
  })

  cache = { at: Date.now(), data: out }
  return out
}

export async function getById(skuId: string): Promise<WineCard | null> {
  const all = await listInStock()
  return all.find(w => w.id === skuId) ?? null
}
