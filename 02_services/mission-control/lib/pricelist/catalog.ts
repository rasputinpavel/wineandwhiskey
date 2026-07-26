import { sbInventory, sbMarketing } from '@/lib/supabase'
import type { CatalogRow } from './types'
import { zoneFromWineColor } from './plaques'

// Reads inventory.v_sku_breakdown, left-joins marketing.sku_enrichment by
// loyverse_product_code so region/producer/volume prefill where known.
export async function readCatalog(): Promise<CatalogRow[]> {
  const { data: skus, error } = await sbInventory
    .from('v_sku_breakdown')
    .select('loyverse_product_code,name,wine_color,grape_variety,wine_country,default_price,on_hand')
  if (error) throw error

  const { data: enr } = await sbMarketing
    .from('sku_enrichment')
    .select('loyverse_product_code,region,producer,volume')
  const enrMap = new Map((enr ?? []).map(e => [e.loyverse_product_code, e]))

  return (skus ?? [])
    .filter(s => s.loyverse_product_code)
    .map(s => {
      const e = enrMap.get(s.loyverse_product_code)
      return {
        code: s.loyverse_product_code,
        name: s.name,
        price: s.default_price ?? null,
        zone: zoneFromWineColor(s.wine_color),
        grape: s.grape_variety ?? undefined,
        country: s.wine_country ?? undefined,
        region: e?.region ?? undefined,
        producer: e?.producer ?? undefined,
        volume: e?.volume ?? undefined,
        onHand: s.on_hand ?? 0,
      }
    })
}
