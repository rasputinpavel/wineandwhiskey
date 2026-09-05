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
import { runOwnedPool, allocateOwnedPlacement, type BuyoutLot, type SaleEvent, type WriteoffEvent } from '@/lib/consignment-buyout-math'

export const CONSIGNMENT_VAT_RATE = 0.07

// Period arithmetic ("YYYY-MM" ± n months). Shared so report nav + Pulse's
// obligation→cycle mapping agree.
export function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// A buyout is dated, not timestamped. It takes effect at Bangkok midnight of
// that day — same convention as the cycle bounds (lib/billing-cycle.ts) — so a
// sale later that same day already draws from the units we just bought.
function bangkokMidnightIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - 7 * 60 * 60 * 1000).toISOString()
}

type SkuInfo = { id: string; name: string; loyverse_product_code: string | null; category: string | null }

export type SettlementRow = {
  sku_id: string; sku_name: string; sku_code: string
  opening: number | null; delivered: number; closing: number | null
  closingAuto: number | null; closingManual: number | null
  b2c: number; b2cAuto: number; b2cOverride: number | null
  b2b: number; b2bAuto: number; b2bOverride: number | null
  tastings: number; sold: number; hc: number | null; amount: number | null
  onHand: number | null   // live Loyverse stock (v_sku_breakdown.on_hand) for period-end reconciliation
  // ── Buyout (migration 042) — units we own outright, mixed into the same stock.
  boughtOut: number       // units bought out of consignment DURING this cycle
  ownSold: number         // of this cycle's sales, units that came from OUR pool → not billable
  billable: number        // sold − ownSold; this is what the supplier is paid for
  ownWriteoff: number     // our own units written off this cycle (no sale, nobody billed)
  ownRemaining: number    // our unsold units at cycle end (in ON HAND, not in Closing)
  expectedOnHand: number | null   // closing + ownRemaining — what Loyverse should show
}

// One line of a buyout invoice, enriched with what became of those units.
export type BuyoutLine = {
  sku_id: string; sku_name: string; sku_code: string
  qty: number; unitPrice: number | null; value: number | null
  soldOut: number         // units already sold through the till
  writtenOff: number      // units of ours written off without a sale
  inTransit: number       // invoiced to a B2B client, not paid yet
  atPartners: number      // out at a partner on our own consignment
  inStore: number         // still on our shelf
  remaining: number       // inTransit + atPartners + inStore
  remainingValue: number | null
}

// A buyout invoice: its lines plus the money split between sold and unsold.
export type BuyoutInvoice = {
  invoiceNo: string | null
  boughtAt: string
  lines: BuyoutLine[]
  qty: number; soldOut: number; writtenOff: number; inTransit: number; atPartners: number; inStore: number
  subtotal: number; vat: number; total: number
  soldValue: number       // pre-VAT value of the units already sold through the till
  inTransitValue: number  // pre-VAT value of units invoiced to a client but not paid yet
  remainingValue: number  // pre-VAT value of everything still unsold (incl. inTransitValue)
}

export type ConsignmentSettlement = {
  supplier: { id: string; name: string; type: string | null }
  mode: 'cost_plus' | 'retail_minus'
  period: string; prevPeriod: string; label: string
  startDate: string; endExclDate: string
  rows: SettlementRow[]
  totals: { opening: number; delivered: number; b2c: number; b2b: number; tastings: number; sold: number; closing: number; amount: number; boughtOut: number; ownSold: number; billable: number; ownWriteoff: number; ownRemaining: number }
  subtotal: number; vat: number; grandTotal: number
  unpricedSold: number
  excluded: string[]; exclTableMissing: boolean; delTableMissing: boolean
  closedAt: string | null
  closings: { sku_id: string; closing: number }[]
  reconMismatches: number   // # of SKUs whose Closing + own stock ≠ Loyverse ON HAND — review before Close
  // Buyouts (migration 042). `buyoutInvoices` covers every buyout to date, not
  // just this cycle's — the money stays on our books until the bottles sell.
  buyoutInvoices: BuyoutInvoice[]
  hasBuyouts: boolean
  buyoutTableMissing: boolean
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

  // Buyout lines (migration 042) — units bought out of consignment onto our own
  // books. Loaded whole, not just this cycle's: an older buyout still shields
  // today's sales until its units are gone. Defensive if 042 isn't applied yet.
  type BuyoutRow = { id: string; sku_id: string; bought_at: string; qty: number; unit_price: number | null; invoice_no: string | null }
  let buyoutRows: BuyoutRow[] = []
  let buyoutTableMissing = false
  {
    const { data, error } = await sbInventory
      .from('consignment_buyout').select('id, sku_id, bought_at, qty, unit_price, invoice_no')
      .eq('supplier_id', supplierId).order('bought_at')
    if (error) buyoutTableMissing = true
    else buyoutRows = (data ?? []) as BuyoutRow[]
  }
  const buyoutSkuIds = new Set(buyoutRows.map(b => b.sku_id))

  // Own-stock write-offs (migration 043) across EVERY period, not just this one:
  // the own pool is cumulative, so a bottle written off in an earlier cycle must
  // stay gone. Each period's cells are applied at that cycle's end — they say
  // "over this period N of ours went without a sale", not on which day.
  const writeoffsBySku = new Map<string, WriteoffEvent[]>()
  const writeoffThisPeriod = new Map<string, number>()   // raw cell value, for the inline editor
  if (buyoutSkuIds.size) {
    // Errors are swallowed on purpose: before migration 043 the column does not
    // exist, and a missing write-off must not take the whole report down.
    const { data } = await sbInventory
      .from('consignment_report_cell').select('sku_id, period, own_writeoff')
      .eq('supplier_id', supplierId).gt('own_writeoff', 0)
    for (const w of (data ?? []) as Array<{ sku_id: string; period: string; own_writeoff: number }>) {
      const cycleEnd = new Date(Date.parse(cyclePeriodRange(w.period, cycleStartDay).endExclIso) - 1).toISOString()
      writeoffsBySku.set(w.sku_id, [...(writeoffsBySku.get(w.sku_id) ?? []), { atIso: cycleEnd, qty: Number(w.own_writeoff) }])
      if (w.period === period) writeoffThisPeriod.set(w.sku_id, Number(w.own_writeoff))
    }
  }

  // SKUs that have report cells or a buyout but aren't priced yet — still show
  // them with HC = n/a so opening/closing reconcile; prices get added later.
  const extraIds = [...new Set(
    [...cells.map(c => c.sku_id), ...buyoutSkuIds].filter(sid => !pricedIds.has(sid)),
  )]
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

  // Pull receipts + lines. The window normally IS the cycle, but a buyout that
  // predates it needs its own-pool history replayed from the day it happened —
  // so reach back to the earliest buyout when there is one.
  const lotsBySku = new Map<string, BuyoutLot[]>()
  for (const b of buyoutRows) {
    const lot: BuyoutLot = { atIso: bangkokMidnightIso(b.bought_at), qty: Number(b.qty) }
    lotsBySku.set(b.sku_id, [...(lotsBySku.get(b.sku_id) ?? []), lot])
  }
  const earliestBuyoutIso = buyoutRows.length ? bangkokMidnightIso(buyoutRows[0].bought_at) : null
  const fetchFromIso = earliestBuyoutIso && earliestBuyoutIso < startIso ? earliestBuyoutIso : startIso

  const fetchedReceipts: any[] = []
  {
    const PAGE = 1000
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await sbInventory
        .from('loyverse_receipt')
        .select('id, receipt_number, receipt_type, is_b2b, receipt_date, loyverse_receipt_line(sku, qty)')
        .gte('receipt_date', fetchFromIso)
        .lt('receipt_date', endExclIso)
        .range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      fetchedReceipts.push(...data)
      if (data.length < PAGE) break
    }
  }

  // Aggregate qty per SKU code, split by B2C/B2B (REFUND subtracts). Only the
  // cycle window counts towards the bill.
  const b2cBySku = new Map<string, number>()
  const b2bBySku = new Map<string, number>()
  // Dated sale events per bought-out SKU, for the own-pool replay.
  const saleEventsBySku = new Map<string, SaleEvent[]>()
  for (const r of fetchedReceipts) {
    if (excludedSet.has(r.receipt_number)) continue
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const inCycle = Date.parse(r.receipt_date) >= Date.parse(startIso)
    const target = r.is_b2b ? b2bBySku : b2cBySku
    for (const ln of (r.loyverse_receipt_line ?? []) as Array<{ sku: string | null; qty: number | null }>) {
      if (!ln.sku) continue
      const sid = skuIdByCode.get(ln.sku)
      if (!sid) continue
      const qty = Number(ln.qty ?? 0) * sign
      if (inCycle) target.set(ln.sku, (target.get(ln.sku) ?? 0) + qty)
      if (buyoutSkuIds.has(sid)) {
        saleEventsBySku.set(sid, [...(saleEventsBySku.get(sid) ?? []), { atIso: r.receipt_date, qty }])
      }
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

  // Live Loyverse on-hand per SKU (inventory.v_sku_breakdown). The report's
  // Closing is a forward formula (Opening + Delivered − Sold − Tastings) seeded
  // from a hand-entered Opening — it NEVER reads live stock, so it drifts
  // silently (tastings/breakage not logged, deliveries not entered, off-till
  // festival pours, handover-count errors). Surfacing ON HAND next to Closing is
  // the period-end reconciliation: at Close, every SKU's Closing must equal it.
  const onHandBySku = new Map<string, number>()
  // Where that stock physically sits — only needed to place our own bought-out
  // units (invoiced-unpaid → out at a partner → on the shelf).
  const transitBySku = new Map<string, number>()
  const atPartnerBySku = new Map<string, number>()
  {
    const ids = reportSkus.map(r => r.sku_id)
    if (ids.length) {
      const { data } = await sbInventory
        .from('v_sku_breakdown').select('sku_id, on_hand, b2b_in_transit, on_consignment').in('sku_id', ids)
      for (const b of (data ?? []) as Array<{ sku_id: string; on_hand: number; b2b_in_transit: number; on_consignment: number }>) {
        onHandBySku.set(b.sku_id, Number(b.on_hand))
        transitBySku.set(b.sku_id, Number(b.b2b_in_transit ?? 0))
        atPartnerBySku.set(b.sku_id, Number(b.on_consignment ?? 0))
      }
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
      const sold = b2c + b2b                               // units that left the till

      // Own pool: units bought out of consignment are already paid for, so the
      // sales they cover are NOT billed again (owner's rule — own stock first).
      const pool = runOwnedPool(lotsBySku.get(rs.sku_id) ?? [], saleEventsBySku.get(rs.sku_id) ?? [], startIso, endExclIso, writeoffsBySku.get(rs.sku_id) ?? [])
      const boughtOut = pool.boughtOutInWindow
      // Clamp against `sold`: that figure may carry a manual override, and we
      // must never shield more units than the report says were sold.
      const ownSold = Math.max(0, Math.min(pool.ownedConsumedInWindow, sold))
      const billable = sold - ownSold
      const ownWriteoff = writeoffThisPeriod.get(rs.sku_id) ?? 0
      const ownRemaining = pool.ownedRemaining

      // Consignment stock loses the bought-out units and only the billable sales;
      // what we sold from our own pool never was the supplier's to begin with.
      const closingAuto = opening != null ? opening + delivered - boughtOut - billable - tastings : null
      const closing = closingManual ?? closingAuto
      // Per-unit PRE-VAT cost: cost_plus → HC; retail_minus → list × (1 − discount).
      // VAT (×1.07) is applied once on the subtotal below. `hc` carries this unit
      // cost for display; null = not priced yet (n/a).
      const basePrice = mode === 'retail_minus' ? rs.priceRetail : rs.priceHc
      const effDiscount = mode === 'retail_minus' ? (rs.skuDiscount ?? supplierDiscountPct) : 0
      const hc = consignmentLineCost({ mode, basePrice, discountPct: effDiscount })
      const amount = hc == null ? null : billable * hc     // tastings are free → excluded
      const onHand = onHandBySku.get(rs.sku_id) ?? null
      // Loyverse holds both pools, so this — not Closing alone — is what ON HAND
      // must equal at period end.
      const expectedOnHand = closing == null ? null : closing + ownRemaining
      return { sku_id: rs.sku_id, sku_name: sku.name, sku_code: code, opening, delivered, closing, closingAuto, closingManual, b2c, b2cAuto, b2cOverride, b2b, b2bAuto, b2bOverride, tastings, sold, hc, amount, onHand, boughtOut, ownSold, billable, ownWriteoff, ownRemaining, expectedOnHand }
    })
    .sort((a, b) => (b.sold + b.tastings + b.delivered) - (a.sold + a.tastings + a.delivered) || a.sku_name.localeCompare(b.sku_name))

  const totals = rows.reduce((acc, r) => {
    acc.b2c += r.b2c; acc.b2b += r.b2b; acc.tastings += r.tastings; acc.sold += r.sold; acc.delivered += r.delivered
    acc.opening += r.opening ?? 0; acc.closing += r.closing ?? 0; acc.amount += r.amount ?? 0
    acc.boughtOut += r.boughtOut; acc.ownSold += r.ownSold; acc.billable += r.billable
    acc.ownWriteoff += r.ownWriteoff; acc.ownRemaining += r.ownRemaining
    return acc
  }, { opening: 0, delivered: 0, b2c: 0, b2b: 0, tastings: 0, sold: 0, closing: 0, amount: 0, boughtOut: 0, ownSold: 0, billable: 0, ownWriteoff: 0, ownRemaining: 0 })

  const unpricedSold = rows.filter(r => r.hc == null && r.billable > 0).length

  // Closed-period state (migration 023). Defensive if table missing.
  let closedAt: string | null = null
  {
    const { data } = await sbInventory
      .from('consignment_report_period').select('closed_at')
      .eq('supplier_id', supplierId).eq('period', period).maybeSingle()
    closedAt = (data as { closed_at?: string } | null)?.closed_at ?? null
  }
  const closings = rows.filter(r => r.closing != null).map(r => ({ sku_id: r.sku_id, closing: r.closing as number }))

  // Reconciliation: count SKUs whose Closing + our own unsold units ≠ live
  // Loyverse on-hand. Only rows where both are known count (unpriced/no-opening
  // rows have null closing). Loyverse sees one pile of bottles; the report
  // splits it into the supplier's stock and ours, so both halves must be added
  // back before the comparison means anything.
  const reconMismatches = rows.filter(r => r.expectedOnHand != null && r.onHand != null && r.expectedOnHand !== r.onHand).length

  // Buyout invoices — grouped by (invoice_no, bought_at), the way they were
  // issued. Reported for ALL buyouts, not just this cycle's: the money stays
  // tied up until the bottles actually sell.
  const rowBySkuId = new Map(rows.map(r => [r.sku_id, r]))
  const invoiceMap = new Map<string, BuyoutInvoice>()
  for (const b of buyoutRows) {
    const r = rowBySkuId.get(b.sku_id)
    if (!r) continue
    const key = `${b.invoice_no ?? ''}|${b.bought_at}`
    let inv = invoiceMap.get(key)
    if (!inv) {
      inv = {
        invoiceNo: b.invoice_no, boughtAt: b.bought_at, lines: [],
        qty: 0, soldOut: 0, writtenOff: 0, inTransit: 0, atPartners: 0, inStore: 0,
        subtotal: 0, vat: 0, total: 0, soldValue: 0, inTransitValue: 0, remainingValue: 0,
      }
      invoiceMap.set(key, inv)
    }
    const qty = Number(b.qty)
    const unitPrice = b.unit_price == null ? null : Number(b.unit_price)
    // The own pool is per SKU, not per invoice line. With one buyout per SKU —
    // the only shape we have — the line simply carries that SKU's pool.
    const remaining = Math.min(qty, r.ownRemaining)
    const placement = allocateOwnedPlacement(remaining, transitBySku.get(b.sku_id) ?? 0, atPartnerBySku.get(b.sku_id) ?? 0)
    // Write-offs across every period, not just this one — a bottle written off
    // in an earlier cycle is gone for good and must not read as "sold".
    const writtenOff = Math.min(qty - remaining, (writeoffsBySku.get(b.sku_id) ?? []).reduce((a, w) => a + w.qty, 0))
    const soldOut = qty - remaining - writtenOff
    const line: BuyoutLine = {
      sku_id: b.sku_id, sku_name: r.sku_name, sku_code: r.sku_code,
      qty, unitPrice, value: unitPrice == null ? null : qty * unitPrice,
      soldOut, writtenOff, ...placement, remaining,
      remainingValue: unitPrice == null ? null : remaining * unitPrice,
    }
    inv.lines.push(line)
    inv.qty += qty; inv.soldOut += soldOut; inv.writtenOff += writtenOff
    inv.inTransit += placement.inTransit; inv.atPartners += placement.atPartners; inv.inStore += placement.inStore
    inv.subtotal += line.value ?? 0
    inv.soldValue += unitPrice == null ? 0 : soldOut * unitPrice
    inv.inTransitValue += unitPrice == null ? 0 : placement.inTransit * unitPrice
    inv.remainingValue += line.remainingValue ?? 0
  }
  const buyoutInvoices = [...invoiceMap.values()]
    .map(inv => ({ ...inv, vat: inv.subtotal * CONSIGNMENT_VAT_RATE, total: inv.subtotal * (1 + CONSIGNMENT_VAT_RATE) }))
    .sort((a, b) => b.boughtAt.localeCompare(a.boughtAt))

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
    reconMismatches,
    buyoutInvoices, hasBuyouts: buyoutRows.length > 0, buyoutTableMissing,
  }
}
