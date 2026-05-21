// Server-side data loader for the Reactivation page.
//
// Pulls B2C-only receipts (is_b2b=false) with a customer card attached
// (customer_id NOT NULL) from inventory.loyverse_receipt + lines + sku,
// aggregates per customer, and returns a list ranked by net spend.
//
// All formatting / grouping / message templating lives upstream; this
// module just produces the raw aggregate.

import { sbInventory } from '@/lib/supabase'
import { isExcludedCustomer } from './excluded'

const DEFAULT_WINDOW_DAYS = 365

export type ReactivationProduct = {
  /** sku code (Loyverse product code) or product_name fallback */
  key: string
  name: string
  qty: number
  revenue: number
  category: string
}

export type ReactivationCustomer = {
  customerId: string
  name: string
  email: string | null
  phone: string | null
  receipts: number
  refundCount: number
  totalSpent: number
  firstVisit: string
  lastVisit: string
  daysSinceLastVisit: number
  byCategory: Array<{ category: string; qty: number; revenue: number }>
  topProducts: ReactivationProduct[]   // sorted by qty desc, capped at 10
}

type ReceiptRow = {
  id: string
  receipt_date: string
  receipt_type: string
  customer_id: string | null
  customer_name: string | null
  total: number
}
type LineRow = {
  receipt_id: string
  sku: string | null
  product_name: string | null
  qty: number
  line_total: number
}
type SkuRow = {
  loyverse_product_code: string | null
  name: string
  category: string | null
}
type CustomerRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
}

function isoDaysAgo(d: string): number {
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}

export async function loadReactivationCustomers(
  opts: { windowDays?: number } = {},
): Promise<ReactivationCustomer[]> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS
  const since = new Date(Date.now() - windowDays * 86400 * 1000).toISOString()

  // 1) Receipts — B2C, with customer card, in window.
  const receipts: ReceiptRow[] = []
  for (let page = 0; ; page++) {
    const from = page * 1000
    const { data, error } = await sbInventory
      .from('loyverse_receipt')
      .select('id, receipt_date, receipt_type, customer_id, customer_name, total')
      .eq('is_b2b', false)
      .not('customer_id', 'is', null)
      .gte('receipt_date', since)
      .order('receipt_date', { ascending: false })
      .range(from, from + 999)
    if (error) throw new Error(`receipts: ${error.message}`)
    if (!data || data.length === 0) break
    receipts.push(...(data as ReceiptRow[]))
    if (data.length < 1000) break
  }
  if (receipts.length === 0) return []

  const receiptById = new Map(receipts.map(r => [r.id, r]))

  // 2) Lines — chunked .in() to stay under PostgREST 16 KB header limit.
  const lines: LineRow[] = []
  const receiptIds = receipts.map(r => r.id)
  for (let i = 0; i < receiptIds.length; i += 100) {
    const chunk = receiptIds.slice(i, i + 100)
    const { data, error } = await sbInventory
      .from('loyverse_receipt_line')
      .select('receipt_id, sku, product_name, qty, line_total')
      .in('receipt_id', chunk)
    if (error) throw new Error(`lines: ${error.message}`)
    if (data) lines.push(...(data as LineRow[]))
  }

  // 3) SKU master — for category mapping.
  const skus: SkuRow[] = []
  for (let page = 0; ; page++) {
    const from = page * 1000
    const { data, error } = await sbInventory
      .from('sku')
      .select('loyverse_product_code, name, category')
      .range(from, from + 999)
    if (error) throw new Error(`sku: ${error.message}`)
    if (!data || data.length === 0) break
    skus.push(...(data as SkuRow[]))
    if (data.length < 1000) break
  }
  const catByCode = new Map<string, string>()
  const nameByCode = new Map<string, string>()
  for (const s of skus) {
    if (!s.loyverse_product_code) continue
    if (s.category) catByCode.set(s.loyverse_product_code, s.category)
    nameByCode.set(s.loyverse_product_code, s.name)
  }

  // 4) Customer contact info.
  const customerIds = Array.from(new Set(receipts.map(r => r.customer_id!).filter(Boolean)))
  const customerById = new Map<string, CustomerRow>()
  for (let i = 0; i < customerIds.length; i += 100) {
    const chunk = customerIds.slice(i, i + 100)
    const { data, error } = await sbInventory
      .from('loyverse_customer')
      .select('id, name, email, phone')
      .in('id', chunk)
    if (error) throw new Error(`customers: ${error.message}`)
    for (const c of (data ?? []) as CustomerRow[]) customerById.set(c.id, c)
  }

  // 5) Aggregate per customer.
  type ProdAgg = ReactivationProduct
  type CustAgg = {
    customerId: string
    name: string
    email: string | null
    phone: string | null
    receipts: number
    refundCount: number
    totalSpent: number
    firstVisit: string
    lastVisit: string
    products: Map<string, ProdAgg>
    byCategory: Map<string, { qty: number; revenue: number }>
  }
  const agg = new Map<string, CustAgg>()

  for (const r of receipts) {
    const cid = r.customer_id!
    const c = customerById.get(cid)
    const name = (c?.name ?? r.customer_name ?? '').trim() || '(unnamed)'
    if (isExcludedCustomer(name)) continue
    let a = agg.get(cid)
    if (!a) {
      a = {
        customerId: cid,
        name,
        email: c?.email ?? null,
        phone: c?.phone ?? null,
        receipts: 0,
        refundCount: 0,
        totalSpent: 0,
        firstVisit: r.receipt_date,
        lastVisit: r.receipt_date,
        products: new Map(),
        byCategory: new Map(),
      }
      agg.set(cid, a)
    }
    const isRefund = r.receipt_type === 'REFUND'
    if (isRefund) a.refundCount += 1
    else a.receipts += 1
    a.totalSpent += (isRefund ? -1 : 1) * Number(r.total ?? 0)
    if (r.receipt_date > a.lastVisit) a.lastVisit = r.receipt_date
    if (r.receipt_date < a.firstVisit) a.firstVisit = r.receipt_date
  }

  for (const l of lines) {
    const r = receiptById.get(l.receipt_id)
    if (!r || !r.customer_id) continue
    const a = agg.get(r.customer_id)
    if (!a) continue
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const code = l.sku ?? ''
    const key = code || (l.product_name ?? '(no name)')
    const cat = (code ? catByCode.get(code) : undefined) ?? 'Uncategorised'
    const niceName = (code ? nameByCode.get(code) : undefined) ?? l.product_name ?? '(no name)'

    let p = a.products.get(key)
    if (!p) { p = { key, name: niceName, qty: 0, revenue: 0, category: cat }; a.products.set(key, p) }
    p.qty     += sign * Number(l.qty ?? 0)
    p.revenue += sign * Number(l.line_total ?? 0)

    let cAgg = a.byCategory.get(cat)
    if (!cAgg) { cAgg = { qty: 0, revenue: 0 }; a.byCategory.set(cat, cAgg) }
    cAgg.qty     += sign * Number(l.qty ?? 0)
    cAgg.revenue += sign * Number(l.line_total ?? 0)
  }

  // 6) Materialise + sort.
  const out: ReactivationCustomer[] = [...agg.values()]
    .map(a => ({
      customerId: a.customerId,
      name: a.name,
      email: a.email,
      phone: a.phone,
      receipts: a.receipts,
      refundCount: a.refundCount,
      totalSpent: a.totalSpent,
      firstVisit: a.firstVisit,
      lastVisit: a.lastVisit,
      daysSinceLastVisit: isoDaysAgo(a.lastVisit),
      byCategory: [...a.byCategory.entries()]
        .map(([category, v]) => ({ category, ...v }))
        .sort((x, y) => y.revenue - x.revenue),
      topProducts: [...a.products.values()]
        .sort((x, y) => y.qty - x.qty)
        .slice(0, 10),
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent)

  return out
}
