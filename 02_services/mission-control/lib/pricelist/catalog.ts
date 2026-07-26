import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { sbInventory, sbMarketing } from '@/lib/supabase'
import type { CatalogRow } from './types'
import { inferZone } from './plaques'
import { imageKey } from './images'

// Map exact name-signature → existing product-image slug, for confident
// (no-wrong-bottle) auto-matching of SKUs to the curated bottle-shot library.
async function imageLibraryByKey(): Promise<Map<string, string>> {
  const dir = path.join(process.cwd(), 'public', 'brand', 'products')
  const files = await readdir(dir).catch(() => [] as string[])
  const map = new Map<string, string>()
  for (const f of files) {
    if (!f.toLowerCase().endsWith('.png')) continue
    // Skip dated batch variants (e.g. abrau-…_16_may.png) — prefer the clean slug.
    if (/_(?:\d+_)?(?:may|apr|jun|jul|aug|sep|manual)$/i.test(f.replace(/\.png$/i, ''))) continue
    const slug = f.replace(/\.png$/i, '')
    const k = imageKey(slug)
    if (k && !map.has(k)) map.set(k, slug)
  }
  return map
}

// PostgREST caps a single response at ~1000 rows, but the catalog has 3000+
// SKUs — page through all of them so search sees the whole inventory.
const PAGE = 1000

type SkuRow = {
  loyverse_product_code: string | null; name: string; category: string | null
  wine_color: string | null; grape_variety: string | null; wine_country: string | null
  default_price: number | null; on_hand: number | null
}

async function readAllSkus(): Promise<SkuRow[]> {
  const all: SkuRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sbInventory
      .from('v_sku_breakdown')
      .select('loyverse_product_code,name,category,wine_color,grape_variety,wine_country,default_price,on_hand')
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
  const [skus, imgByKey] = await Promise.all([readAllSkus(), imageLibraryByKey()])

  // image_slug/image_url arrive with migration 036 — read tolerantly so the
  // catalog still works before it's applied (falls back to the base columns).
  type EnrRow = { loyverse_product_code: string; region?: string | null; producer?: string | null
    volume?: string | null; image_slug?: string | null; image_url?: string | null }
  let enr = (await sbMarketing.from('sku_enrichment')
    .select('loyverse_product_code,region,producer,volume,image_slug,image_url')) as { data: EnrRow[] | null; error: unknown }
  if (enr.error) {
    enr = await sbMarketing.from('sku_enrichment').select('loyverse_product_code,region,producer,volume')
  }
  const enrMap = new Map((enr.data ?? []).map(e => [e.loyverse_product_code, e]))

  return skus
    .filter((s): s is SkuRow & { loyverse_product_code: string } => !!s.loyverse_product_code)
    .map(s => {
      const e = enrMap.get(s.loyverse_product_code)
      // Photo priority: uploaded image_url → explicitly-picked image_slug →
      // confident library match by exact name-signature → none (placeholder).
      const imageUrl = e?.image_url ?? undefined
      const imageSlug = e?.image_slug ?? imgByKey.get(imageKey(s.name)) ?? undefined
      return {
        code: s.loyverse_product_code,
        name: s.name,
        price: s.default_price ?? null,
        zone: inferZone(s.wine_color, s.category),
        grape: s.grape_variety ?? undefined,
        country: s.wine_country ?? undefined,
        region: e?.region ?? undefined,
        producer: e?.producer ?? undefined,
        volume: e?.volume ?? undefined,
        imageUrl,
        imageSlug,
        onHand: s.on_hand ?? 0,
      }
    })
}
