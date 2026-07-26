import { sbInventory, sbMarketing } from '@/lib/supabase'
import type { CatalogRow } from './types'
import { zoneFromWineColor } from './plaques'

// PostgREST caps a single response at ~1000 rows, but the catalog has 3000+
// SKUs — page through all of them so search sees the whole inventory.
const PAGE = 1000

type SkuRow = {
  loyverse_product_code: string | null; name: string; wine_color: string | null
  grape_variety: string | null; wine_country: string | null
  default_price: number | null; on_hand: number | null
}

async function readAllSkus(): Promise<SkuRow[]> {
  const all: SkuRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sbInventory
      .from('v_sku_breakdown')
      .select('loyverse_product_code,name,wine_color,grape_variety,wine_country,default_price,on_hand')
      .order('name')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const page = (data ?? []) as SkuRow[]
    all.push(...page)
    if (page.length < PAGE) break
  }
  return all
}

// Reads inventory.v_sku_breakdown, left-joins marketing.sku_enrichment by
// loyverse_product_code so region/producer/volume prefill where known.
export async function readCatalog(): Promise<CatalogRow[]> {
  const skus = await readAllSkus()

  const { data: enr } = await sbMarketing
    .from('sku_enrichment')
    .select('loyverse_product_code,region,producer,volume')
  const enrMap = new Map((enr ?? []).map(e => [e.loyverse_product_code, e]))

  return skus
    .filter((s): s is SkuRow & { loyverse_product_code: string } => !!s.loyverse_product_code)
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
