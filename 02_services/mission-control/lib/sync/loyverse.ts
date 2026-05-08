// Server-side Loyverse REST sync — same logic as
// /03_automation/sync_inventory_loyverse.ts but callable from a Next.js
// API route (no dotenv, no process.exit, returns counts).

import { createClient } from '@supabase/supabase-js'

type LoyverseItem = {
  id: string
  item_name: string
  category_id: string | null
  variants: Array<{
    variant_id: string
    sku: string | null
    default_price: number | null
  }>
  track_stock: boolean
}

type LoyverseInventoryLevel = {
  variant_id: string
  store_id: string
  in_stock: number
}

const LOYVERSE_BASE = 'https://api.loyverse.com/v1.0'

function client() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  const token = process.env.LOYVERSE_API_TOKEN
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY missing')
  if (!token)       throw new Error('LOYVERSE_API_TOKEN missing')
  return {
    sb: createClient(url, key, { db: { schema: 'inventory' } }),
    token,
  }
}

async function loyverseGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${LOYVERSE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Loyverse ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function logStart(sb: ReturnType<typeof client>['sb'], source: string): Promise<string> {
  const { data, error } = await sb
    .from('sync_log')
    .insert({ source, started_at: new Date().toISOString() })
    .select('id').single()
  if (error) throw new Error(`sync_log start: ${error.message}`)
  return data!.id as string
}

async function logFinish(sb: ReturnType<typeof client>['sb'], id: string, ok: boolean, error: string | null, rowsIn: number, rowsOut: number) {
  await sb
    .from('sync_log')
    .update({ finished_at: new Date().toISOString(), ok, error, rows_in: rowsIn, rows_out: rowsOut })
    .eq('id', id)
}

async function syncProducts(sb: ReturnType<typeof client>['sb'], token: string) {
  const id = await logStart(sb, 'loyverse_products')
  try {
    const items: LoyverseItem[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page++) {
      const qs = new URLSearchParams({ limit: '250' })
      if (cursor) qs.set('cursor', cursor)
      const data = await loyverseGet<{ items: LoyverseItem[]; cursor?: string }>(`/items?${qs}`, token)
      items.push(...data.items)
      if (!data.cursor) break
      cursor = data.cursor
    }

    const rows = items.flatMap(it => it.variants.map(v => ({
      loyverse_variant_id: v.variant_id,
      loyverse_item_id:    it.id,
      loyverse_product_code: v.sku,
      name:                it.item_name,
      category:            null,
      default_price:       v.default_price,
      is_inventory_tracked: it.track_stock,
      updated_at:          new Date().toISOString(),
    })))

    if (rows.length) {
      const { error } = await sb.from('sku').upsert(rows, { onConflict: 'loyverse_variant_id' })
      if (error) throw new Error(`sku upsert: ${error.message}`)
    }

    await logFinish(sb, id, true, null, items.length, rows.length)
    return { items: items.length, variants: rows.length }
  } catch (e: any) {
    await logFinish(sb, id, false, e?.message ?? String(e), 0, 0)
    throw e
  }
}

async function syncStock(sb: ReturnType<typeof client>['sb'], token: string) {
  const id = await logStart(sb, 'loyverse_stock')
  try {
    const levels: LoyverseInventoryLevel[] = []
    let cursor: string | undefined
    for (let page = 0; page < 200; page++) {
      const qs = new URLSearchParams({ limit: '250' })
      if (cursor) qs.set('cursor', cursor)
      const data = await loyverseGet<{ inventory_levels: LoyverseInventoryLevel[]; cursor?: string }>(`/inventory?${qs}`, token)
      levels.push(...data.inventory_levels)
      if (!data.cursor) break
      cursor = data.cursor
    }

    // Map variant_id → sku.id (need to join via inventory.sku table).
    const skuMap = new Map<string, string>()
    let cur = 0
    for (;;) {
      const { data, error } = await sb.from('sku').select('id, loyverse_variant_id').range(cur, cur + 999)
      if (error) throw new Error(`sku scan: ${error.message}`)
      if (!data?.length) break
      for (const r of data as any[]) skuMap.set(r.loyverse_variant_id, r.id)
      if (data.length < 1000) break
      cur += 1000
    }

    const rows = levels
      .map(l => {
        const sku_id = skuMap.get(l.variant_id)
        if (!sku_id) return null
        return {
          sku_id,
          store_id: l.store_id,
          qty: l.in_stock,
          fetched_at: new Date().toISOString(),
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (rows.length) {
      const { error } = await sb.from('loyverse_stock').upsert(rows, { onConflict: 'sku_id,store_id' })
      if (error) throw new Error(`stock upsert: ${error.message}`)
    }

    await logFinish(sb, id, true, null, levels.length, rows.length)
    return { levels: levels.length, written: rows.length, skipped: levels.length - rows.length }
  } catch (e: any) {
    await logFinish(sb, id, false, e?.message ?? String(e), 0, 0)
    throw e
  }
}

// One entry point for the API route. Runs both products and stock sync.
export async function runLoyverseSync(): Promise<{ products: { items: number; variants: number }; stock: { levels: number; written: number; skipped: number } }> {
  const { sb, token } = client()
  const products = await syncProducts(sb, token)
  const stock    = await syncStock(sb, token)
  return { products, stock }
}
