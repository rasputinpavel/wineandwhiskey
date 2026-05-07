import { createClient } from '@supabase/supabase-js'

// One server-side Supabase client per schema. We talk directly with PostgREST
// using the service-role key — middleware already protects every page behind
// the password cookie.

const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_KEY!

export const sbInventory = createClient(url, key, { db: { schema: 'inventory' } })

// ─── Inventory schema types ─────────────────────────────────────────────
// Mirror of inventory/supabase/migrations/001_inventory.sql.

export type Sku = {
  id: string
  loyverse_variant_id: string
  loyverse_item_id: string | null
  loyverse_product_code: string | null
  name: string
  category: string | null
  default_price: number | null
  is_inventory_tracked: boolean
  updated_at: string
}

export type FlowInvoice = {
  id: string
  number: string
  customer_id: string | null
  customer_name: string
  issued_at: string
  due_at: string | null
  status: 'Paid' | 'Unpaid' | 'Overdue' | 'Cancelled' | string
  total: number
  detail_url: string | null
  scraped_at: string
}

export type SkuBreakdown = {
  sku_id: string
  loyverse_product_code: string | null
  name: string
  category: string | null
  on_hand: number
  b2b_in_transit: number
  on_consignment: number
  in_store: number
}

export type SyncSource =
  | 'loyverse_stock'
  | 'loyverse_products'
  | 'flowaccount_invoices'
  | 'flowaccount_receipts'

export type SyncLog = {
  id: string
  source: SyncSource
  started_at: string
  finished_at: string | null
  ok: boolean | null
  error: string | null
  rows_in: number | null
  rows_out: number | null
}

export async function lastSync(source: SyncSource): Promise<SyncLog | null> {
  const { data } = await sbInventory
    .from('sync_log')
    .select('*')
    .eq('source', source)
    .eq('ok', true)
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as SyncLog | null
}
