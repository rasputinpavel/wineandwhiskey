// Consignment settlement math — the SINGLE home for it.
//
// A consignment supplier is paid for the units SOLD in a billing cycle.
// Two modes (per supplier.settlement_mode), both +7% VAT, tastings free:
//   cost_plus    (Harvest)      Amount = sold × HC
//   retail_minus (Cigar Empire) Amount = sold × listPrice × (1 − discount)
// The per-unit math lives in lib/consignment-math.ts. The cycle window comes from
// lib/billing-cycle.ts (Harvest = 5th-to-5th). This function is the one source of
// truth, consumed by BOTH the supplier monthly report page and the Pulse break-even
// forecast, so the two can never drift.
//
// Throws on schema/query errors (caller decides how to surface). Returns null
// only when the supplier id doesn't exist.

import { sbInventory } from '@/lib/supabase'
import { cyclePeriodRange } from '@/lib/billing-cycle'
import { consignmentLineCost } from '@/lib/consignment-math'

export const CONSIGNMENT_VAT_RATE = 0.07

// Period arithmetic ("YYYY-MM" ± n months). Shared so report nav + Pulse's
// obligation→cycle mapping agree.
export function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

type SkuInfo = { id: string; name: string; loyverse_product_code: string | null; category: string | null }

export type SettlementRow = {
  sku_id: string; sku_name: string; sku_code: string
  opening: number | null; delivered: number; closing: number | null
  closingAuto: number | null; closingManual: number | null
  b2c: number; b2cAuto: number; b2cOverride: number | null
  b2b: number; b2bAuto: number; b2bOverride: number | null
  tastings: number; sold: number; hc: number | null; amount: number | null
}

export type ConsignmentSettlement = {
  supplier: { id: string; name: string; type: string | null }
  mode: 'cost_plus' | 'retail_minus'
  period: string; prevPeriod: string; label: string
  startDate: string; endExclDate: string
  rows: SettlementRow[]
  totals: { opening: number; delivered: number; b2c: number; b2b: number; tastings: number; sold: number; closing: number; amount: number }
  subtotal: number; vat: number; grandTotal: number
  unpricedSold: number
  excluded: string[]; exclTableMissing: boolean; delTableMissing: boolean
  closedAt: string | null
  closings: { sku_id: string; closing: number }[]
}

export async function computeConsignmentSettlement(
  supplierId: string,
  period: string,
): Promise<ConsignmentSettlement | null> {
  const prevPeriod = shiftMonth(period, -1)

  const [supRes, pricesRes] = await Promise.all([
    sbInventory.from('supplier').select('id, name, type, monthly_cycle_start_day, settlement_mode, consignment_discount_pct').eq('id', supplierId).maybeSingle(),
    sbInventory.from('consignment_price').select('sku_id, price_hc, price_retail, discount_pct, sku:sku(id, name, loyverse_product_code, category)').eq('supplier_id', supplierId).limit(2000),
  ])
  if (supRes.error) throw new Error(supRes.error.message)
  if (!supRes.data) return null
  if (pricesRes.error) throw new Error(pricesRes.error.message)
  const s = supRes.data as { id: string; name: string; type: string | null; monthly_cycle_start_day?: number; settlement_mode?: string; consignment_discount_pct?: number }
  // Billing-cycle start day (1 = calendar month; Harvest = 5 → 5th-to-5th).
  const cycleStartDay = Number(s.monthly_cycle_start_day ?? 1)
  const mode: 'cost_plus' | 'retail_minus' = s.settlement_mode === 'retail_minus' ? 'retail_minus' : 'cost_plus'
  const supplierDiscountPct = Number(s.consignment_discount_pct ?? 0)
  const { startIso, endExclIso, startDate, endExclDate, label } = cyclePeriodRange(period, cycleStartDay)

  type PriceRow = { sku_id: string; price_hc: number | null; price_retail: number | null; discount_pct: number | null; sku: SkuInfo | null }
  const priceRows = (pricesRes.data ?? []) as unknown as PriceRow[]
  const pricedIds = new Set(priceRows.map(p => p.sku_id))

  // Report cells (current + previous period; prev for opening-stock pre-fill).
  const { data: cellsRaw, error: cellsErr } = await sbInventory
    .from('consignment_report_cell')
    .select('sku_id, period, opening_stock, closing_stock, tastings, b2c_override, b2b_override, notes')
    .eq('supplier_id', supplierId)
    .in('period', [period, prevPeriod])
  if (cellsErr) throw new Error(cellsErr.message)
  type Cell = { sku_id: string; period: string; opening_stock: number | null; closing_stock: number | null; tastings: number; b2c_override: number | null; b2b_override: number | null; notes: string | null }
  const cells = (cellsRaw ?? []) as Cell[]
  const cellByKey = new Map(cells.map(c => [`${c.sku_id}|${c.period}`, c]))

  // SKUs that have report cells but aren't priced yet — still show them with
  // HC = n/a so opening/closing reconcile; prices get added to the list later.
  const extraIds = [...new Set(cells.map(c => c.sku_id).filter(sid => !pricedIds.has(sid)))]
  const extraInfo = new Map<string, SkuInfo>()
  if (extraIds.length) {
    const { data } = await sbInventory.from('sku').select('id, name, loyverse_product_code, category').in('id', extraIds)
    for (const sk of (data ?? []) as SkuInfo[]) extraInfo.set(sk.id, sk)
  }

  // Unified SKU list: priced (with prices) first, then unpriced cell SKUs.
  type ReportSku = { sku_id: string; info: SkuInfo; priceHc: number | null; priceRetail: number | null; skuDiscount: number | null }
  const reportSkus: ReportSku[] = []
  for (const p of priceRows) if (p.sku) reportSkus.push({
    sku_id: p.sku_id, info: p.sku,
    priceHc: p.price_hc == null ? null : Number(p.price_hc),
    priceRetail: p.price_retail == null ? null : Number(p.price_retail),
    skuDiscount: p.discount_pct == null ? null : Number(p.discount_pct),
  })
  for (const sid of extraIds) { const info = extraInfo.get(sid); if (info) reportSkus.push({ sku_id: sid, info, priceHc: null, priceRetail: null, skuDiscount: null }) }

  const codeBySkuId = new Map(reportSkus.map(r => [r.sku_id, r.info.loyverse_product_code ?? null]))
  const skuIdByCode = new Map<string, string>()
  for (const [sid, code] of codeBySkuId) if (code) skuIdByCode.set(code, sid)

  // Receipts excluded from this period's settlement (e.g. off-consignment B2B
  // batches). Defensive: if migration 021 isn't applied yet, treat as empty.
  let excluded: string[] = []
  let exclTableMissing = false
  {
    const { data, error } = await sbInventory
      .from('consignment_report_exclusion').select('receipt_number')
      .eq('supplier_id', supplierId).eq('period', period)
    if (error) exclTableMissing = true
    else excluded = (data ?? []).map((r: { receipt_number: string }) => r.receipt_number)
  }
  const excludedSet = new Set(excluded)

  // Pull receipts + lines for the cycle window.
  const monthReceipts: any[] = []
  {
    const PAGE = 1000
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await sbInventory
        .from('loyverse_receipt')
        .select('id, receipt_number, receipt_type, is_b2b, receipt_date, loyverse_receipt_line(sku, qty)')
        .gte('receipt_date', startIso)
        .lt('receipt_date', endExclIso)
        .range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      monthReceipts.push(...data)
      if (data.length < PAGE) break
    }
  }

  // Aggregate qty per SKU code, split by B2C/B2B (REFUND subtracts).
  const b2cBySku = new Map<string, number>()
  const b2bBySku = new Map<string, number>()
  for (const r of monthReceipts) {
    if (excludedSet.has(r.receipt_number)) continue
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const target = r.is_b2b ? b2bBySku : b2cBySku
    for (const ln of (r.loyverse_receipt_line ?? []) as Array<{ sku: string | null; qty: number | null }>) {
      if (!ln.sku) continue
      if (!skuIdByCode.has(ln.sku)) continue
      target.set(ln.sku, (target.get(ln.sku) ?? 0) + Number(ln.qty ?? 0) * sign)
    }
  }

  // Deliveries (stock arrivals booked outside POs) within the period, summed
  // per SKU by delivery date. Defensive if migration 022 isn't applied yet.
  const deliveredBySku = new Map<string, number>()
  let delTableMissing = false
  {
    const { data, error } = await sbInventory
      .from('consignment_delivery').select('sku_id, qty')
      .eq('supplier_id', supplierId).gte('delivered_at', startDate).lt('delivered_at', endExclDate)
    if (error) delTableMissing = true
    else for (const d of (data ?? []) as Array<{ sku_id: string; qty: number }>) {
      deliveredBySku.set(d.sku_id, (deliveredBySku.get(d.sku_id) ?? 0) + Number(d.qty))
    }
  }

  // Build rows.
  const rows: SettlementRow[] = reportSkus
    .map(rs => {
      const sku = rs.info
      const code = sku.loyverse_product_code ?? ''
      const b2cAuto = Math.round(b2cBySku.get(code) ?? 0)
      const b2bAuto = Math.round(b2bBySku.get(code) ?? 0)
      const thisCell = cellByKey.get(`${rs.sku_id}|${period}`)
      const prevCell = cellByKey.get(`${rs.sku_id}|${prevPeriod}`)
      const opening = thisCell?.opening_stock ?? prevCell?.closing_stock ?? null
      const closingManual = thisCell?.closing_stock ?? null
      const tastings = thisCell?.tastings ?? 0
      const b2cOverride = thisCell?.b2c_override ?? null
      const b2bOverride = thisCell?.b2b_override ?? null
      const b2c = b2cOverride ?? b2cAuto
      const b2b = b2bOverride ?? b2bAuto
      const delivered = deliveredBySku.get(rs.sku_id) ?? 0
      const sold = b2c + b2b                               // billable units
      const closingAuto = opening != null ? opening + delivered - sold - tastings : null
      const closing = closingManual ?? closingAuto
      // Per-unit PRE-VAT cost: cost_plus → HC; retail_minus → list × (1 − discount).
      // VAT (×1.07) is applied once on the subtotal below. `hc` carries this unit
      // cost for display; null = not priced yet (n/a).
      const basePrice = mode === 'retail_minus' ? rs.priceRetail : rs.priceHc
      const effDiscount = mode === 'retail_minus' ? (rs.skuDiscount ?? supplierDiscountPct) : 0
      const hc = consignmentLineCost({ mode, basePrice, discountPct: effDiscount })
      const amount = hc == null ? null : sold * hc         // tastings are free → excluded
      return { sku_id: rs.sku_id, sku_name: sku.name, sku_code: code, opening, delivered, closing, closingAuto, closingManual, b2c, b2cAuto, b2cOverride, b2b, b2bAuto, b2bOverride, tastings, sold, hc, amount }
    })
    .sort((a, b) => (b.sold + b.tastings + b.delivered) - (a.sold + a.tastings + a.delivered) || a.sku_name.localeCompare(b.sku_name))

  const totals = rows.reduce((acc, r) => {
    acc.b2c += r.b2c; acc.b2b += r.b2b; acc.tastings += r.tastings; acc.sold += r.sold; acc.delivered += r.delivered
    acc.opening += r.opening ?? 0; acc.closing += r.closing ?? 0; acc.amount += r.amount ?? 0
    return acc
  }, { opening: 0, delivered: 0, b2c: 0, b2b: 0, tastings: 0, sold: 0, closing: 0, amount: 0 })

  const unpricedSold = rows.filter(r => r.hc == null && r.sold > 0).length

  // Closed-period state (migration 023). Defensive if table missing.
  let closedAt: string | null = null
  {
    const { data } = await sbInventory
      .from('consignment_report_period').select('closed_at')
      .eq('supplier_id', supplierId).eq('period', period).maybeSingle()
    closedAt = (data as { closed_at?: string } | null)?.closed_at ?? null
  }
  const closings = rows.filter(r => r.closing != null).map(r => ({ sku_id: r.sku_id, closing: r.closing as number }))

  const subtotal = totals.amount
  const vat = subtotal * CONSIGNMENT_VAT_RATE
  const grandTotal = subtotal + vat

  return {
    supplier: { id: s.id, name: s.name, type: s.type ?? null },
    mode,
    period, prevPeriod, label,
    startDate, endExclDate,
    rows, totals,
    subtotal, vat, grandTotal,
    unpricedSold,
    excluded, exclTableMissing, delTableMissing,
    closedAt, closings,
  }
}
