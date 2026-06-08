import { createClient } from '@supabase/supabase-js'

// One server-side Supabase client per schema. We talk directly with PostgREST
// using the service-role key — middleware already protects every page behind
// the password cookie.

const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_KEY!

export const sbInventory = createClient(url, key, { db: { schema: 'inventory' } })

// Sales CRM — leads, scrape runs, activity log. See migration 013_sales_crm.sql.
// Schema `sales` must be added to "Exposed schemas" in Supabase settings or
// PostgREST returns 404.
export const sbSales = createClient(url, key, { db: { schema: 'sales' } })

// Promo Pulse — weekly promo campaigns. See migration 014_promo_campaigns.sql.
// Schema `promo` must also be added to "Exposed schemas".
export const sbPromo = createClient(url, key, { db: { schema: 'promo' } })

// Default `public` schema client — used for tables that live outside our
// custom inventory schema (today: purchase_orders + purchase_order_items
// populated by 03_automation/scrape_purchase_orders.ts).
export const sbPublic = createClient(url, key)

// ─── public.purchase_orders types ───────────────────────────────────────

export type CashflowOverride = 'auto' | 'include' | 'exclude'

export type PurchaseOrder = {
  id: number
  po_number: string
  loyverse_id: number | null
  order_date: string | null
  expected_on: string | null
  supplier: string | null
  store: string | null
  status: string | null
  received: string | null
  total_thb: number | null
  subtotal_thb: number | null
  vat_thb: number | null
  url: string | null
  scraped_at: string
  scrape_error: string | null
  cashflow_override: CashflowOverride
  paid_at: string | null     // ISO date YYYY-MM-DD; null = не оплачено
  docs_url: string | null    // ссылка на Google Drive с tax invoice + receipt
}

export type PurchaseOrderItem = {
  id: number
  po_id: number
  po_number: string
  product_name: string
  sku: string                 // Loyverse product code — joins to inventory.sku.loyverse_product_code
  qty_ordered: number
  qty_received: number
  cost_price: number
  line_total: number
  scraped_at: string
}

// ─── Inventory schema types ─────────────────────────────────────────────
// Mirror of inventory/supabase/migrations/001_inventory.sql.

export type SupplierType = 'regular' | 'consignment' | 'mix'

export type Supplier = {
  id: string
  name: string
  type: SupplierType
  payment_terms_days: number
  monthly_cycle_start_day: number   // 1 = calendar month; e.g. Harvest = 5 (5th-to-5th)
  notes: string | null
  created_at: string
  updated_at: string
}

export type B2bCustomer = {
  id: string
  flowaccount_name: string
  loyverse_customer_id: string | null
  payment_terms_days: number
  credit_limit: number | null
  is_consignment: boolean
  notes: string | null
  group_id: string | null      // FK на b2b_customer_group; null = не в группе
  created_at: string
  updated_at: string
}

export type B2bCustomerGroup = {
  id: string
  name: string
  notes: string | null
  created_at: string
  updated_at: string
}

export type FixedCost = {
  id: string
  category: string
  amount_thb: number | null        // null when percent_revenue is set
  percent_revenue: number | null   // 0-100; non-null → pct-of-revenue, amount_thb ignored
  active: boolean
  notes: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type PulseSettings = {
  id: number
  fixed_buffer_pct: number
  updated_at: string
}

// ─── Income / Cash module (migration 024) ───────────────────────────────────

export type WalletId = 'account' | 'cash' | 'personal'

export type MoneyWallet = {
  id: WalletId
  name: string
  opening_balance: number
  opening_date: string          // 'YYYY-MM-DD'
  sort_order: number
  created_at: string
  updated_at: string
}

export type MoneyMovement = {
  id: string
  occurred_on: string           // 'YYYY-MM-DD'
  kind: 'inflow' | 'outflow' | 'transfer'
  amount: number
  wallet_id: WalletId | null    // inflow / outflow target
  from_wallet_id: WalletId | null
  to_wallet_id: WalletId | null
  note: string | null
  created_at: string
}

export type LoyverseCustomer = {
  id: string
  name: string
  email: string | null
  phone: string | null
  total_spent: number
  scraped_at: string
}

export type LoyverseReceipt = {
  id: string
  receipt_number: string
  loyverse_receipt_id: string | null
  receipt_date: string
  receipt_type: 'SALE' | 'REFUND' | string
  store: string | null
  customer_id: string | null
  customer_name: string | null
  total: number
  cost_total: number
  is_b2b: boolean
  is_bank_transfer: boolean
  payment_method: 'cash' | 'card' | 'qr' | 'transfer' | 'other' | null
  scraped_at: string
}

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
  // Migration 019 — Wine Matrix attributes. Nullable for non-wine SKUs.
  wine_color: 'red' | 'white' | 'rose' | 'sparkling' | 'orange' | null
  grape_variety: string | null
  wine_country: string | null
  wine_attrs_source: 'auto' | 'manual' | null
  wine_attrs_updated_at: string | null
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
  excluded: boolean
}

export type ConsignmentPrice = {
  id: string
  supplier_id: string
  sku_id: string
  price_hc: number
  price_retail: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type ConsignmentLocation = {
  id: string
  customer_id: string
  name: string
  created_at: string
}

export type DeliveryNote = {
  id: string
  location_id: string
  number: string
  issued_at: string
  status: 'draft' | 'issued' | 'delivered'
  pdf_url: string | null
  created_by: string | null
  created_at: string
}

export type DeliveryNoteLine = {
  id: string
  note_id: string
  sku_id: string
  qty: number
  unit_price: number | null
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
