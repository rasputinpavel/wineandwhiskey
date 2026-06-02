import Link from 'next/link'
import { sbInventory, sbPublic, type LoyverseReceipt, type FlowInvoice, type B2bCustomer, type Supplier, type PurchaseOrder, type FixedCost } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { DataFreshness } from '@/components/shell/DataFreshness'
import {
  lastNMonths, mtdProgress, computeDueDate, daysBetween, isoNDaysAgo,
  fmtThb, fmtThbCompact, todayBkk,
} from '@/lib/kpi'

export const dynamic = 'force-dynamic'

// ════════════════════════════════════════════════════════════════════════════
// Owner P&L — cash-basis bookkeeping
//
//   Revenue           Σ Loyverse receipts in month (SALE − REFUND)
//                     B2C cash + B2B paid bank transfers / card.
//                     Unpaid FA tax invoices are AR, not revenue, until they
//                     create a Loyverse receipt at payment.
//
//   Supplier payments Σ purchase_orders where payment_date ∈ month, where
//                     payment_date = paid_at if set, else order_date +
//                     supplier.payment_terms_days (0 if unknown). For POs
//                     without an explicit paid_at, payment_date ≤ today is
//                     assumed paid. PLUS consignment debt for the selected
//                     month (Σ sold_qty × price_hc per consignment supplier)
//                     — consignment is invoiced monthly per actual sales and
//                     is a real obligation even without a PO.
//
//   GP                Revenue − Supplier payments. NOT "cost of goods sold"
//                     in the bookkeeping sense — it's the cash margin after
//                     paying suppliers what's due this month.
//
//   GM% (ref)         (Revenue − Loyverse receipt.cost) / Revenue. Reference
//                     metric for unit economics; NOT used in Net calc.
//
//   Net               GP − Fixed costs (MTD pro-rata).
//
// Period: current calendar month for headline; 18 months for trend.
// ════════════════════════════════════════════════════════════════════════════

// Fetch window grace: we pull POs going back this many extra days before
// the trend window starts so any whose computed payment_date falls inside
// the window is captured. 60d covers the longest reasonable supplier terms.
const AP_FETCH_GRACE_DAYS = 60

// Previous calendar month for a 'YYYY-MM' key.
function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

type SearchParams = { month?: string; settle?: 'month' | 'total' }

export default async function PulseDashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  // 13 months so the trailing 12 + current both fit, and same-month-prior-year
  // sits as the leftmost bar (year-over-year comparison at a glance).
  const months = lastNMonths(13)
  const validYms = new Set(months.map(m => m.fromDate.slice(0, 7)))
  const monthsStart = months[0].fromDate                  // 13 months ago, 1st
  const monthsStartIso = monthsStart + 'T00:00:00Z'
  // Consignment obligation of the oldest trend month comes from the month
  // BEFORE the window, so fetch receipt lines starting one month earlier.
  const consignLinesStartIso = prevYm(months[0].fromDate.slice(0, 7)) + '-01T00:00:00Z'
  const today = todayBkk()
  const { daysInMonth: currentDaysInMonth, daysPassed: currentDaysPassed } = mtdProgress()
  const currentMonth = months[months.length - 1]
  const currentYm = currentMonth.fromDate.slice(0, 7)
  // ?month=YYYY-MM jumps the Hero + Waterfall into a past month. Trend chart and
  // Cash control stay live (full 13m / today's snapshot).
  const monthParam = typeof sp.month === 'string' && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null
  const settleView: 'month' | 'total' = sp.settle === 'total' ? 'total' : 'month'
  const selectedYm = monthParam && validYms.has(monthParam) ? monthParam : currentYm
  const isCurrent  = selectedYm === currentYm
  const selectedMonth = months.find(m => m.fromDate.slice(0, 7) === selectedYm) ?? currentMonth
  const startOfMonth = selectedMonth.fromDate
  const endOfMonthExclusive = selectedMonth.toDate
  const endOfMonthInclusive = computeDueDate(endOfMonthExclusive, -1)
  // For past months treat as fully elapsed; current month uses live MTD progress.
  const selectedDaysInMonth = isCurrent
    ? currentDaysInMonth
    : new Date(Date.UTC(Number(selectedYm.slice(0, 4)), Number(selectedYm.slice(5, 7)), 0)).getUTCDate()
  const selectedDaysPassed = isCurrent ? currentDaysPassed : selectedDaysInMonth

  // To capture POs whose payment date (order + 30d) falls within the trend
  // window, we need orders up to 30 days before the window starts.
  const poStart = isoNDaysAgo(daysBetween(today, monthsStart) + AP_FETCH_GRACE_DAYS)

  // PostgREST max-rows is 1000 on Supabase Cloud — `.limit(N>1000)` is
  // silently capped. Page over 1000-row windows to fetch the full set.
  async function fetchAllReceipts(): Promise<LoyverseReceipt[]> {
    const all: LoyverseReceipt[] = []
    const PAGE = 1000
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await sbInventory
        .from('loyverse_receipt')
        .select('total, cost_total, is_b2b, receipt_type, receipt_date')
        .gte('receipt_date', monthsStartIso)
        .order('receipt_date', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      all.push(...(data as LoyverseReceipt[]))
      if (data.length < PAGE) break
    }
    return all
  }
  async function fetchAllPOs(): Promise<PurchaseOrder[]> {
    const all: PurchaseOrder[] = []
    const PAGE = 1000
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await sbPublic
        .from('purchase_orders')
        .select('id, supplier, total_thb, order_date, paid_at, cashflow_override')
        .gte('order_date', poStart)
        .order('order_date', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      all.push(...(data as PurchaseOrder[]))
      if (data.length < PAGE) break
    }
    return all
  }

  // Receipt lines across the whole window (for consignment debt: sold-units ×
  // price), folded per month downstream. Embedded receipt_line array per
  // receipt; PostgREST resolves the join.
  async function fetchAllReceiptLines(fromIso: string): Promise<any[]> {
    const all: any[] = []
    const PAGE = 1000
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await sbInventory
        .from('loyverse_receipt')
        .select('receipt_date, receipt_type, loyverse_receipt_line(sku, qty)')
        .gte('receipt_date', fromIso)
        .order('receipt_date', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      all.push(...data)
      if (data.length < PAGE) break
    }
    return all
  }

  // ─── Fetch ───────────────────────────────────────────────────────────────
  let receiptsAll: LoyverseReceipt[] = []
  let posAll: PurchaseOrder[] = []
  let allReceiptLines: any[] = []
  try {
    const [r, p, lines] = await Promise.all([
      fetchAllReceipts(),
      fetchAllPOs(),
      fetchAllReceiptLines(consignLinesStartIso),
    ])
    receiptsAll = r
    posAll = p
    allReceiptLines = lines
  } catch (e: any) {
    return <SchemaError error={String(e?.message ?? e)} />
  }
  const [
    fixedCostsRes,
    invoicesOpenRes,
    customersRes,
    suppliersRes,
    consignmentPricesRes,
    pulseSettingsRes,
  ] = await Promise.all([
    sbInventory
      .from('fixed_cost')
      .select('amount_thb, percent_revenue, active'),
    sbInventory
      .from('flowaccount_invoice')
      .select('id, total, status, issued_at, due_at, customer_id, customer_name')
      .neq('status', 'Cancelled')
      .eq('excluded', false),
    sbInventory
      .from('b2b_customer')
      .select('id, payment_terms_days'),
    sbInventory
      .from('supplier')
      .select('id, name, type, payment_terms_days'),
    sbInventory
      .from('consignment_price')
      .select('id, supplier_id, price_hc, sku:sku(id, loyverse_product_code)')
      .limit(5000),
    sbInventory
      .from('pulse_settings')
      .select('fixed_buffer_pct')
      .eq('id', 1)
      .maybeSingle(),
  ])

  for (const r of [invoicesOpenRes, customersRes, suppliersRes]) {
    if (r.error) return <SchemaError error={r.error.message} />
  }

  // ─── Aggregation per month ───────────────────────────────────────────────
  type Bucket = {
    b2c: number; b2b: number; total: number; refRevCost: number
    supplierPayments: number
  }
  const empty = (): Bucket => ({ b2c: 0, b2b: 0, total: 0, refRevCost: 0, supplierPayments: 0 })
  const byMonth = new Map<string, Bucket>()
  for (const m of months) byMonth.set(m.fromDate.slice(0, 7), empty())

  // Revenue (Loyverse receipts)
  for (const r of receiptsAll) {
    const ym = r.receipt_date.slice(0, 7)
    const b  = byMonth.get(ym); if (!b) continue
    const sign  = r.receipt_type === 'REFUND' ? -1 : 1
    const total = Number(r.total) * sign
    const cost  = Number(r.cost_total ?? 0) * sign
    b.total += total
    b.refRevCost += cost
    if (r.is_b2b) b.b2b += total; else b.b2c += total
  }

  // Supplier payments — bucketed by payment_date = paid_at if set, else
  // order_date + supplier.payment_terms_days.
  type SupRow = Pick<Supplier, 'id' | 'name' | 'type' | 'payment_terms_days'>
  const suppliers = (suppliersRes.data ?? []) as SupRow[]
  const supByName = new Map(suppliers.map(s => [s.name.trim().toLowerCase(), s]))
  const supById   = new Map(suppliers.map(s => [s.id, s]))
  // Per-supplier payment terms. 0 = cash-on-delivery (payment_date = order_date).
  // Unknown supplier → 0 days as well.
  function termsFor(supplierName: string | null): number {
    if (!supplierName) return 0
    return supByName.get(supplierName.trim().toLowerCase())?.payment_terms_days ?? 0
  }
  // Authoritative cash-out date for a PO:
  //   paid_at → explicit, trust it
  //   else order_date + supplier.payment_terms_days
  function payDate(p: Pick<PurchaseOrder, 'paid_at' | 'order_date' | 'supplier'>): string {
    if (p.paid_at) return p.paid_at
    if (!p.order_date) return ''
    return computeDueDate(p.order_date, termsFor(p.supplier))
  }
  function includedInCashflow(p: Pick<PurchaseOrder, 'cashflow_override' | 'supplier'>): boolean {
    const t = p.supplier ? supByName.get(p.supplier.trim().toLowerCase())?.type : undefined
    // Consignment supplier POs document the prior-month invoice; pulse uses
    // real-time accrual (sold_qty × price_hc) instead so we don't double-count.
    // cashflow_override is honored only for non-consignment suppliers.
    if (t === 'consignment') return false
    if (p.cashflow_override === 'exclude') return false
    if (p.cashflow_override === 'include') return true
    return true
  }
  const allPOs = posAll.filter(includedInCashflow)

  type PayPo = { total: number; paymentDate: string }
  const supplierPayments: PayPo[] = []
  for (const p of allPOs) {
    if (!p.order_date) continue
    const pd = payDate(p)
    supplierPayments.push({ total: Number(p.total_thb ?? 0), paymentDate: pd })
    const ym = pd.slice(0, 7)
    const b = byMonth.get(ym)
    if (b) b.supplierPayments += Number(p.total_thb ?? 0)
  }

  // Consignment debt: Σ (sold_qty × price_hc) per consignment supplier,
  // where sold_qty = SALE − REFUND units of each SKU and price_hc is the
  // agreed HC consignment price.
  //
  // TIMING — consignment is invoiced and paid on ~the 5th of the FOLLOWING
  // month. So sales of month M are a cash obligation of month M+1, NOT of M.
  // We fold per-supplier debt by SALES month, then book each calendar month's
  // obligation from the PRIOR month's sales (consignObligation*). Because the
  // source month is always a closed month, the number is stable — it no longer
  // drifts intra-month nor flickers when a live join lags.
  //
  // PostgREST many-to-one embeds come back as a single object; supabase-js
  // types it as an array regardless — hence the unknown cast.
  type ConsignPrice = { supplier_id: string; price_hc: number; sku: { loyverse_product_code: string | null } | null }
  const consignmentPrices = (consignmentPricesRes.data ?? []) as unknown as ConsignPrice[]
  const priceByCode = new Map<string, { supplierId: string; price: number }>()
  for (const cp of consignmentPrices) {
    const code = cp.sku?.loyverse_product_code
    if (!code || !cp.supplier_id) continue
    priceByCode.set(code, { supplierId: cp.supplier_id, price: Number(cp.price_hc ?? 0) })
  }
  // ym → supplierId → consignment debt accrued from THAT month's sales.
  const consignSalesByMonth = new Map<string, Map<string, number>>()
  for (const r of allReceiptLines) {
    const ym = (r.receipt_date as string).slice(0, 7)
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const lines = (r.loyverse_receipt_line ?? []) as Array<{ sku: string | null; qty: number | null }>
    for (const ln of lines) {
      if (!ln.sku) continue
      const hit = priceByCode.get(ln.sku)
      if (!hit) continue
      let bucket = consignSalesByMonth.get(ym)
      if (!bucket) { bucket = new Map(); consignSalesByMonth.set(ym, bucket) }
      bucket.set(hit.supplierId, (bucket.get(hit.supplierId) ?? 0) + Number(ln.qty ?? 0) * hit.price * sign)
    }
  }
  // Obligation booked in month `ym` = consignment SALES of the previous month.
  function consignObligationBySupId(ym: string): Map<string, number> {
    return consignSalesByMonth.get(prevYm(ym)) ?? new Map<string, number>()
  }
  function consignObligationTotal(ym: string): number {
    return [...consignObligationBySupId(ym).values()].filter(d => d > 0).reduce((s, d) => s + d, 0)
  }
  // Settlements table reads this for the selected month.
  const consignDebtBySupId = consignObligationBySupId(selectedYm)
  // Fold each month's consignment obligation into its supplier-payments bucket
  // so trend bars + closed-month P&L carry it. The current month additionally
  // uses supplierPaymentsMtd (which adds the same obligation) for its headline.
  for (const m of months) {
    const ym = m.fromDate.slice(0, 7)
    const b = byMonth.get(ym)
    if (b) b.supplierPayments += consignObligationTotal(ym)
  }

  // Fixed costs — two kinds:
  //   fixed rows  → flat THB/month (rent, salary, …)
  //   pct rows    → percent of monthly revenue (tax, royalties, …)
  // The buffer % (configurable in Settings) is applied to fixed-THB only —
  // pct rows already scale with revenue and don't need a contingency on top.
  type FxCost = Pick<FixedCost, 'amount_thb' | 'percent_revenue' | 'active'>
  const fixedCostRows = ((fixedCostsRes.data ?? []) as FxCost[]).filter(r => r.active)
  const monthlyFixedBase = fixedCostRows
    .filter(r => r.percent_revenue == null)
    .reduce((s, r) => s + Number(r.amount_thb ?? 0), 0)
  const fixedPctOfRevenue = fixedCostRows
    .filter(r => r.percent_revenue != null)
    .reduce((s, r) => s + Number(r.percent_revenue ?? 0), 0) / 100
  const bufferPct = Number((pulseSettingsRes.data as { fixed_buffer_pct?: number } | null)?.fixed_buffer_pct ?? 15) / 100
  // Helper: full-month fixed for a given revenue (used by trend, projection, etc.)
  function fixedForMonth(revenue: number): number {
    return monthlyFixedBase * (1 + bufferPct) + revenue * fixedPctOfRevenue
  }
  // Legacy convenience: fixed cost assuming the selected month's revenue.
  const monthlyFixed = monthlyFixedBase * (1 + bufferPct)

  // ─── Per-month P&L ───────────────────────────────────────────────────────
  // For closed months: supplierPayments = full-month bucket; fixed = full.
  // For current month:
  //   trend cell shows MTD supplier payments (payment_date ≤ today)
  //   projection uses full-month bucket (already in byMonth)
  type MonthPnl = { ym: string; label: string; revenue: number; revenueB2C: number; revenueB2B: number; supplierPayments: number; gp: number; fixed: number; net: number; isCurrent: boolean }
  const currentYM = currentMonth.fromDate.slice(0, 7)

  // Always anchored to the CURRENT month — this is what the trend's current
  // bar shows ("paid so far this month"), and must not move with the
  // selected-month filter.
  const supplierPaymentsMtd = supplierPayments
    .filter(p => p.paymentDate >= currentMonth.fromDate && p.paymentDate <= today)
    .reduce((s, p) => s + p.total, 0)
    + consignObligationTotal(currentYm)

  const monthsPnl: MonthPnl[] = months.map(m => {
    const ym = m.fromDate.slice(0, 7)
    const b  = byMonth.get(ym) ?? empty()
    const cur = ym === currentYm
    // Fixed-THB pro-rated for current month MTD; pct-of-revenue already scales
    // by revenue (which is MTD for current month, full for closed months).
    const fixed = cur
      ? monthlyFixedBase * (1 + bufferPct) * (currentDaysPassed / currentDaysInMonth) + b.total * fixedPctOfRevenue
      : monthlyFixedBase * (1 + bufferPct) + b.total * fixedPctOfRevenue
    const sup   = cur ? supplierPaymentsMtd : b.supplierPayments
    const gp    = b.total - sup
    return { ym, label: m.label, revenue: b.total, revenueB2C: b.b2c, revenueB2B: b.b2b, supplierPayments: sup, gp, fixed, net: gp - fixed, isCurrent: cur }
  })
  const selected      = monthsPnl.find(m => m.ym === selectedYm) ?? monthsPnl[monthsPnl.length - 1]
  const selectedBucket = byMonth.get(selectedYm) ?? empty()

  // Hero/Waterfall: selected.supplierPayments already carries the consignment
  // obligation (folded into byMonth for closed months, into supplierPaymentsMtd
  // for the current month), so no override is needed. We surface the obligation
  // amount separately for the PO/Consignment breakout line.
  const selectedConsignObligation = consignObligationTotal(selectedYm)
  const selectedSupplierPayments = selected.supplierPayments
  const selectedGp  = selected.revenue - selectedSupplierPayments
  const selectedNet = selectedGp - selected.fixed

  // Reference Gross Margin % (from Loyverse cost_total) for the selected month.
  const refGmPct = selectedBucket.total > 0
    ? ((selectedBucket.total - selectedBucket.refRevCost) / selectedBucket.total) * 100
    : 0

  // ─── Projected EOM ───────────────────────────────────────────────────────
  // Revenue projection:
  //   B2C: pace × scale
  //   B2B paid: keep MTD (already received)
  //   B2B inflows from open FA invoices whose due date falls by EOM
  const customers = (customersRes.data ?? []) as Pick<B2bCustomer, 'id' | 'payment_terms_days'>[]
  const termsByCustomer = new Map(customers.map(c => [c.id, c.payment_terms_days ?? 0]))
  const allActiveInvoices = (invoicesOpenRes.data ?? []) as FlowInvoice[]
  const openInvoices = allActiveInvoices.filter(i => i.status !== 'Paid')

  function invoiceDueAt(inv: FlowInvoice): string {
    if (inv.due_at) return inv.due_at
    const terms = inv.customer_id ? (termsByCustomer.get(inv.customer_id) ?? 0) : 0
    return terms > 0 ? computeDueDate(inv.issued_at, terms) : inv.issued_at
  }

  const b2bDueByEom = openInvoices
    .filter(inv => invoiceDueAt(inv) <= endOfMonthInclusive)
    .reduce((s, inv) => s + Number(inv.total), 0)

  // Projection logic only matters for the current month. Past months are final.
  const currentBucket = byMonth.get(currentYm) ?? empty()
  const scale = isCurrent && currentDaysPassed > 0 ? currentDaysInMonth / currentDaysPassed : 1
  const projB2C        = (isCurrent ? selectedBucket.b2c : 0) * (isCurrent ? scale : 1)
  const projRevenue    = isCurrent
    ? projB2C + selectedBucket.b2b + b2bDueByEom
    : selected.revenue
  const projSupplier   = isCurrent ? currentBucket.supplierPayments : selectedSupplierPayments
  const projGp         = projRevenue - projSupplier
  const projNet        = isCurrent ? (projGp - fixedForMonth(projRevenue)) : selectedNet
  // For "more by EOM" sub on waterfall — only meaningful when looking at current.
  const revenueRemainingProj  = isCurrent ? Math.max(0, projRevenue - selected.revenue) : 0
  const supplierRemainingProj = isCurrent ? Math.max(0, projSupplier - selectedSupplierPayments) : 0

  // ─── Next Month Outlook ──────────────────────────────────────────────────
  // Cash-out side of next month is already known: POs ordered THIS month
  // mature 30d later, so their payments fall in next month. Plus full monthly
  // fixed. Cash-in is unknown except for B2B credit sales already invoiced
  // and maturing in next month — we treat that as guaranteed inflow.
  //
  //   minRevenueRequired = supplier_payments_NEXT + monthlyFixed
  //   expectedB2BInflow  = open FA invoices with due_at in NEXT calendar month
  //   minB2CRequired     = max(0, minRevenueRequired − expectedB2BInflow)
  //
  // Always anchored to CURRENT calendar month → next, regardless of the
  // selected month filter (the filter scopes the past view, not the forecast).
  const nextMonthDate    = new Date(Date.UTC(Number(currentYm.slice(0, 4)), Number(currentYm.slice(5, 7)), 1))
  const nextMonthFrom    = nextMonthDate.toISOString().slice(0, 10)
  const nextMonthToExcl  = new Date(Date.UTC(nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
  const nextMonthLabel   = `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][nextMonthDate.getUTCMonth()]} ${String(nextMonthDate.getUTCFullYear()).slice(-2)}`
  const nextMonthYm      = nextMonthFrom.slice(0, 7)

  // POs payable next month + next month's consignment obligation (= THIS
  // month's in-progress consignment sales, invoiced ~5th of next month).
  const supplierPaymentsNext = supplierPayments
    .filter(p => p.paymentDate >= nextMonthFrom && p.paymentDate < nextMonthToExcl)
    .reduce((s, p) => s + p.total, 0)
    + consignObligationTotal(nextMonthYm)

  const expectedB2BNext = openInvoices
    .filter(inv => {
      const d = invoiceDueAt(inv)
      return d >= nextMonthFrom && d < nextMonthToExcl
    })
    .reduce((s, inv) => s + Number(inv.total), 0)

  // Solve R = sup + base*(1+buf) + R*pct  →  R = (sup + base*(1+buf)) / (1 - pct).
  // Guard pct ≥ 1 (cost scales beyond 100% of revenue → no break-even possible).
  const minRevenueNext = fixedPctOfRevenue >= 1
    ? Infinity
    : (supplierPaymentsNext + monthlyFixedBase * (1 + bufferPct)) / (1 - fixedPctOfRevenue)
  const minB2CNext     = Number.isFinite(minRevenueNext) ? Math.max(0, minRevenueNext - expectedB2BNext) : minRevenueNext

  // ─── Cash control: AR Open / AP Open / Net WC ────────────────────────────
  const arOpen = openInvoices.reduce((s, i) => s + Number(i.total), 0)
  let arOverdue = 0
  for (const inv of openInvoices) {
    if (invoiceDueAt(inv) < today) arOverdue += Number(inv.total)
  }

  // AP Open = supplier payments not yet due ("we pay on time" → past-due assumed paid).
  const apOpen = supplierPayments
    .filter(p => p.paymentDate > today)
    .reduce((s, p) => s + p.total, 0)
  const workingCapital = arOpen - apOpen

  // ─── Settlements for the selected month ──────────────────────────────────
  // Suppliers — POs whose payment_date (order+30d) falls in the selected
  // month. "Paid" follows the same on-time assumption used elsewhere:
  // payment_date ≤ today → paid; > today → still owed.
  type SupSet = { name: string; total: number; paid: number }
  const supSettleMap = new Map<string, SupSet>()
  for (const p of allPOs) {
    if (!p.order_date) continue
    const pd = payDate(p)
    if (pd < startOfMonth || pd >= endOfMonthExclusive) continue
    const name = p.supplier ?? '(unknown)'
    const cur  = supSettleMap.get(name) ?? { name, total: 0, paid: 0 }
    const v = Number(p.total_thb ?? 0)
    cur.total += v
    if (pd <= today) cur.paid += v
    supSettleMap.set(name, cur)
  }
  // Merge selected-month consignment debt (computed earlier) into the
  // settlements table — consignment suppliers have no POs so this is the
  // only path they reach the table.
  for (const [supId, debt] of consignDebtBySupId) {
    if (debt <= 0) continue
    const sup = supById.get(supId)
    const name = sup?.name ?? '(unknown consignment)'
    const cur = supSettleMap.get(name) ?? { name, total: 0, paid: 0 }
    cur.total += debt
    supSettleMap.set(name, cur)
  }

  const supSettlements = [...supSettleMap.values()].sort((a, b) => b.total - a.total)
  const supSettleTotal = supSettlements.reduce((s, x) => s + x.total, 0)
  const supSettlePaid  = supSettlements.reduce((s, x) => s + x.paid, 0)

  // B2B customers — FA invoices due in the selected month (paid + unpaid)
  // PLUS overdue (unpaid with due before the selected month start).
  type CustSet = { name: string; thisMonthTotal: number; thisMonthPaid: number; overdue: number }
  const custSettleMap = new Map<string, CustSet>()
  const nameByCustomerId = new Map(customers.map(() => ['', ''] as [string, string]))
  // Bring B2B customer flowaccount_name lookup back — we stripped it earlier in this refactor.
  const b2bRows = (customersRes.data ?? []) as Pick<B2bCustomer, 'id' | 'payment_terms_days'>[]
  void b2bRows
  for (const inv of allActiveInvoices) {
    const dueAt = invoiceDueAt(inv)
    const isPaid = inv.status === 'Paid'
    const inMonth = dueAt >= startOfMonth && dueAt < endOfMonthExclusive
    const overdue = !isPaid && dueAt < startOfMonth
    if (!inMonth && !overdue) continue
    const name = inv.customer_name || '(unknown)'
    const cur = custSettleMap.get(name) ?? { name, thisMonthTotal: 0, thisMonthPaid: 0, overdue: 0 }
    const v = Number(inv.total)
    if (inMonth) {
      cur.thisMonthTotal += v
      if (isPaid) cur.thisMonthPaid += v
    } else if (overdue) {
      cur.overdue += v
    }
    custSettleMap.set(name, cur)
  }
  const custSettlements = [...custSettleMap.values()].sort((a, b) => {
    // overdue first, then by remaining (unpaid this month), then total
    if ((b.overdue > 0) !== (a.overdue > 0)) return b.overdue - a.overdue
    return (b.thisMonthTotal - b.thisMonthPaid) - (a.thisMonthTotal - a.thisMonthPaid)
  })
  // Invoices issued this month but with a due date in a future month — they
  // don't show up in the dueAt-keyed settlements above, but the user expects
  // to see "I invoiced them this month" somewhere. Surfaced as a sub-line
  // under the B2B settlements header without inflating cash-flow-due totals.
  const b2bIssuedDueNext = openInvoices.reduce((s, inv) => {
    const issued = inv.issued_at
    const due = invoiceDueAt(inv)
    if (issued >= startOfMonth && issued < endOfMonthExclusive && due >= endOfMonthExclusive) return s + Number(inv.total)
    return s
  }, 0)
  const custSettleTotal    = custSettlements.reduce((s, x) => s + x.thisMonthTotal, 0)
  const custSettlePaid     = custSettlements.reduce((s, x) => s + x.thisMonthPaid, 0)
  const custSettleOverdue  = custSettlements.reduce((s, x) => s + x.overdue, 0)

  // ─── Settlements · TOTAL (all-time open obligations) ─────────────────────
  // Suppliers: all POs whose payment_date is in the future or within 14d
  // grace of today (i.e. not yet assumed paid). Customer side: all open
  // FA invoices (unpaid + not cancelled).
  type TotalSupRow = { name: string; openTotal: number; dueSoon: number }   // dueSoon = within next 7d
  const totalSupMap = new Map<string, TotalSupRow>()
  for (const p of allPOs) {
    if (!p.order_date) continue
    const pd = payDate(p)
    const dpd = daysBetween(pd, today)        // positive = future
    if (dpd < 0) continue                      // past-due = assumed paid (we pay on time)
    const name = p.supplier ?? '(unknown)'
    const cur = totalSupMap.get(name) ?? { name, openTotal: 0, dueSoon: 0 }
    const v = Number(p.total_thb ?? 0)
    cur.openTotal += v
    if (dpd <= 7) cur.dueSoon += v
    totalSupMap.set(name, cur)
  }
  const totalSups = [...totalSupMap.values()].sort((a, b) => b.openTotal - a.openTotal)
  const totalSupSum     = totalSups.reduce((s, x) => s + x.openTotal, 0)
  const totalSupDueSoon = totalSups.reduce((s, x) => s + x.dueSoon, 0)

  type TotalCustRow = { name: string; openTotal: number; overdue: number }
  const totalCustMap = new Map<string, TotalCustRow>()
  for (const inv of openInvoices) {
    const name = inv.customer_name || '(unknown)'
    const dueAt = invoiceDueAt(inv)
    const isOverdue = dueAt < today
    const cur = totalCustMap.get(name) ?? { name, openTotal: 0, overdue: 0 }
    const v = Number(inv.total)
    cur.openTotal += v
    if (isOverdue) cur.overdue += v
    totalCustMap.set(name, cur)
  }
  const totalCusts = [...totalCustMap.values()].sort((a, b) => {
    if ((b.overdue > 0) !== (a.overdue > 0)) return b.overdue - a.overdue
    return b.openTotal - a.openTotal
  })
  const totalCustSum     = totalCusts.reduce((s, x) => s + x.openTotal, 0)
  const totalCustOverdue = totalCusts.reduce((s, x) => s + x.overdue, 0)
  void apOpen; void arOverdue; void workingCapital  // surfaced via settlements now

  // ─── Headline insight ────────────────────────────────────────────────────
  const headline = isCurrent
    ? buildHeadline({ netMtd: selectedNet, netProjected: projNet, monthlyFixed })
    : buildPastHeadline({ net: selectedNet, monthLabel: selected.label })

  // For trend chart scale, ignore extreme single months by using max(|net|).
  const trendMax = Math.max(1, ...monthsPnl.map(m => Math.abs(m.net)))

  // Trailing-12-month totals (closed months only — exclude in-progress current).
  const closedMonths   = monthsPnl.slice(0, -1)
  const annualTotalNet = closedMonths.reduce((s, m) => s + m.net, 0)
  const annualAvgNet   = closedMonths.length > 0 ? annualTotalNet / closedMonths.length : 0
  const annualTotalRev = closedMonths.reduce((s, m) => s + m.revenue, 0)
  const annualAvgRev   = closedMonths.length > 0 ? annualTotalRev / closedMonths.length : 0

  return (
    <>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">
          {isCurrent ? "This month's bottom line" : `${selected.label} · final`}
        </h2>
        <div className="flex items-center gap-3">
          {!isCurrent && (
            <Link href="/m/pulse" className="text-[11px] text-graphite hover:text-wine-red font-mono">
              ← back to current
            </Link>
          )}
          <DataFreshness sources={['loyverse_stock', 'flowaccount_invoices', 'flowaccount_receipts', 'purchase_orders']} />
        </div>
      </div>

      {/* Break-even reference for the selected month: total cash needed
          (full-month supplier + full-month fixed-with-buffer). Current
          revenue is what's already in the books (MTD or final). */}
      {(() => null)() /* placeholder to keep below const list legible */}

      {/* ─── Row 1: This Month + Next Month (hero pair) ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <ThisMonthCard
          monthLabel={selected.label}
          isCurrent={isCurrent}
          net={selectedNet}
          netProjected={projNet}
          daysPassed={selectedDaysPassed}
          daysInMonth={selectedDaysInMonth}
          headline={headline}
          revenue={selected.revenue}
          revenueB2C={selected.revenueB2C}
          revenueB2B={selected.revenueB2B}
          revenueRemainingProj={revenueRemainingProj}
          supplierPayments={selectedSupplierPayments}
          supplierPaymentsRemaining={supplierRemainingProj}
          supplierConsignment={selectedConsignObligation}
          gp={selectedGp}
          fixedMtd={selected.fixed}
          monthlyFixedBase={monthlyFixedBase}
          bufferPct={bufferPct}
          fixedPctOfRevenue={fixedPctOfRevenue}
          refGmPct={refGmPct}
          breakevenRevenue={
            fixedPctOfRevenue >= 1
              ? Infinity
              : ((isCurrent ? currentBucket.supplierPayments : selectedSupplierPayments) + monthlyFixedBase * (1 + bufferPct)) / (1 - fixedPctOfRevenue)
          }
        />
        <NextMonthCard
          monthLabel={nextMonthLabel}
          supplierPaymentsNext={supplierPaymentsNext}
          monthlyFixed={Number.isFinite(minRevenueNext) ? fixedForMonth(minRevenueNext) : monthlyFixed}
          monthlyFixedBase={monthlyFixedBase}
          bufferPct={bufferPct}
          fixedPctOfRevenue={fixedPctOfRevenue}
          expectedB2BNext={expectedB2BNext}
          minRevenueNext={minRevenueNext}
          minB2CNext={minB2CNext}
        />
      </div>

      {/* ─── Row 2: Trend chart full width ───────────────────────────────── */}
      <div className="mb-3">
        <TrendCard
          months={monthsPnl}
          max={trendMax}
          selectedYm={selectedYm}
          annualTotalNet={annualTotalNet}
          annualAvgNet={annualAvgNet}
          annualTotalRev={annualTotalRev}
          annualAvgRev={annualAvgRev}
          closedCount={closedMonths.length}
        />
      </div>

      {/* ─── Row 3: Settlements (this month / total tabs) ───────────────── */}
      <div className="mb-3">
        <SettlementsCard
          view={settleView}
          monthLabel={selected.label}
          isCurrent={isCurrent}
          monthHref={`/m/pulse${selectedYm !== currentYm ? `?month=${selectedYm}` : ''}`}
          totalHref={`/m/pulse?settle=total${selectedYm !== currentYm ? `&month=${selectedYm}` : ''}`}
          // this-month
          monthSuppliers={supSettlements}
          monthSupTotal={supSettleTotal}
          monthSupPaid={supSettlePaid}
          monthCustomers={custSettlements}
          monthCustTotal={custSettleTotal}
          monthCustPaid={custSettlePaid}
          monthCustOverdue={custSettleOverdue}
          monthB2bIssuedDueNext={b2bIssuedDueNext}
          // total
          totalSuppliers={totalSups}
          totalSupSum={totalSupSum}
          totalSupDueSoon={totalSupDueSoon}
          totalCustomers={totalCusts}
          totalCustSum={totalCustSum}
          totalCustOverdue={totalCustOverdue}
          arOpen={arOpen}
          apOpen={apOpen}
          workingCapital={workingCapital}
        />
      </div>

      <details className="mt-3 bg-warm-white border border-pale-stone rounded-md text-xs">
        <summary className="cursor-pointer px-4 py-2 text-graphite hover:text-wine-red list-none flex items-center gap-1">
          <span className="text-pale-stone">▸</span> Methodology
        </summary>
        <div className="px-4 pb-4 pt-1 text-graphite space-y-2 leading-relaxed">
          <p><span className="text-deep-black">Basis</span> — cash. Revenue is recognised when money lands in Loyverse (B2C cash/card and B2B bank transfers). Unpaid FA tax invoices are AR (visible in Cash control), not revenue.</p>
          <p><span className="text-deep-black">Revenue</span> = Σ Loyverse receipts in month, SALE minus REFUND. Cancelled receipts are not yet filtered (Phase 2 — they&apos;re rare).</p>
          <p><span className="text-deep-black">Supplier payments</span> = Σ purchase orders whose payment date falls in the month. Payment date = <span className="font-mono">paid_at</span> if explicitly set, else <span className="font-mono">order_date + supplier.payment_terms_days</span> (0d for unknown suppliers). POs without paid_at whose computed date ≤ today are treated as paid. Consignment suppliers tracked via monthly accrual, not POs.</p>
          <p><span className="text-deep-black">Gross Profit</span> = Revenue − Supplier payments. Not the bookkeeping COGS — it&apos;s the cash margin after settling what&apos;s due to suppliers this month. <span className="text-deep-black">GM% (reference)</span> in the waterfall sub-line is the unit-economics margin from Loyverse cost_total — not used in Net.</p>
          <p><span className="text-deep-black">Fixed costs MTD</span> = fixed-THB portion (rent, payroll, …) × (1 + buffer%) pro-rated by days, plus pct-of-revenue rows (taxes, royalties, …) × revenue. The buffer and the pct list are configured in Settings. For closed months in the 12-month trend we apply the current monthly value to all of them — no history yet.</p>
          <p><span className="text-deep-black">Projection EOM</span>: revenue = B2C pace × scale + B2B already paid this month + open FA invoices whose due date falls by month-end. Supplier payments = full-month sum (already known). Net = projected revenue − projected supplier payments − full monthly fixed.</p>
          <p><span className="text-deep-black">Cash control AP</span> = supplier payments scheduled <em>after</em> today (future obligations). &quot;We pay on time&quot; → past-due POs are assumed settled. Operations tab applies a 14-day grace for surfacing recently-issued invoices; that view is intentionally different.</p>
          <p><span className="text-deep-black">Owner salary</span> is not in fixed costs by current policy — Net is the full take-home before tax.</p>
        </div>
      </details>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Headline
// ════════════════════════════════════════════════════════════════════════════

function buildHeadline(p: { netMtd: number; netProjected: number; monthlyFixed: number }): {
  tone: 'ok' | 'warn' | 'danger'; text: string
} {
  if (p.monthlyFixed === 0) {
    return { tone: 'warn', text: 'Fixed costs not configured — set them in Settings to see net profit.' }
  }
  if (p.netProjected > 0 && p.netMtd > 0) {
    return { tone: 'ok', text: `On pace to take home ${fmtThbCompact(p.netProjected)} this month.` }
  }
  if (p.netProjected > 0 && p.netMtd <= 0) {
    return { tone: 'warn', text: `Still in the red MTD, but pacing toward ${fmtThbCompact(p.netProjected)} by month-end if revenue holds.` }
  }
  if (p.netProjected <= 0 && p.netMtd > 0) {
    return { tone: 'warn', text: `Profitable MTD, but month-end projection is negative (${fmtThbCompact(p.netProjected)}) — supplier and fixed obligations eat the gains.` }
  }
  return { tone: 'danger', text: `On pace for a ${fmtThbCompact(Math.abs(p.netProjected))} loss — owner will need to top up.` }
}

// ════════════════════════════════════════════════════════════════════════════
// UI atoms
// ════════════════════════════════════════════════════════════════════════════

function buildPastHeadline({ net, monthLabel }: { net: number; monthLabel: string }): {
  tone: 'ok' | 'warn' | 'danger'; text: string
} {
  if (net > 0) return { tone: 'ok',     text: `${monthLabel} closed at +${fmtThbCompact(net)} take-home.` }
  if (net < 0) return { tone: 'danger', text: `${monthLabel} closed at a ${fmtThbCompact(Math.abs(net))} loss.` }
  return { tone: 'warn', text: `${monthLabel} closed at break-even.` }
}

// Unified hero for the selected month — mirrors NextMonthCard's structure
// (amber/tone strip + big number + daily-pace breakdown + INPUTS section).
function ThisMonthCard({ monthLabel, isCurrent, net, netProjected, daysPassed, daysInMonth, headline, revenue, revenueB2C, revenueB2B, revenueRemainingProj, supplierPayments, supplierPaymentsRemaining, supplierConsignment, gp, fixedMtd, monthlyFixedBase, bufferPct, fixedPctOfRevenue, refGmPct, breakevenRevenue }: {
  monthLabel: string; isCurrent: boolean
  net: number; netProjected: number
  daysPassed: number; daysInMonth: number
  headline: { tone: 'ok' | 'warn' | 'danger'; text: string }
  revenue: number; revenueB2C: number; revenueB2B: number; revenueRemainingProj: number
  supplierPayments: number; supplierPaymentsRemaining: number; supplierConsignment: number
  gp: number; fixedMtd: number; monthlyFixedBase: number
  bufferPct: number; fixedPctOfRevenue: number
  refGmPct: number
  breakevenRevenue: number
}) {
  const positive  = net >= 0
  const valCls    = positive ? 'text-deep-black' : 'text-wine-red'
  const sign      = positive ? '+' : '−'
  const dailyAvg  = daysPassed > 0 ? net / daysPassed : 0
  const dailyCls  = dailyAvg >= 0 ? 'text-deep-black' : 'text-wine-red'
  const projPos   = netProjected >= 0
  const projCls   = projPos ? 'text-deep-black' : 'text-wine-red'
  const stripBg   = headline.tone === 'danger' ? 'bg-wine-red' : headline.tone === 'warn' ? 'bg-amber-gold' : 'bg-graphite/30'
  const stripLbl  = headline.tone === 'danger' ? 'text-wine-red' : headline.tone === 'warn' ? 'text-amber-gold' : 'text-graphite'

  const headerLabel = isCurrent ? `THIS MONTH · ${monthLabel.toUpperCase()}` : `${monthLabel.toUpperCase()} · FINAL`
  const headerTag   = isCurrent ? 'NET PROFIT MTD' : 'NET PROFIT'
  const fixedParts: string[] = []
  if (monthlyFixedBase > 0) fixedParts.push(`${fmtThb(monthlyFixedBase)}/mo + ${(bufferPct * 100).toFixed(0)}% buffer`)
  if (fixedPctOfRevenue > 0) fixedParts.push(`${(fixedPctOfRevenue * 100).toFixed(1)}% of revenue`)
  const fixedSub = fixedParts.length > 0 ? fixedParts.join(' · ') : 'not configured'

  return (
    <div className="bg-warm-white border border-pale-stone rounded-md shadow-card h-full overflow-hidden flex flex-col">
      <div className="flex items-stretch border-b border-pale-stone">
        <div className={`${stripBg} w-1`} />
        <div className="flex-1 px-5 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[10px] uppercase tracking-overline text-graphite">{headerLabel}</div>
            <div className="text-right">
              <div className={`text-[10px] uppercase tracking-overline ${stripLbl}`}>{headerTag}</div>
              {breakevenRevenue > 0 && (
                <div className="text-[10px] text-graphite font-mono mt-0.5">
                  rev <span className="text-deep-black">{fmtThbCompact(revenue)}</span>
                  {' / be '}<span className="text-deep-black">{fmtThbCompact(breakevenRevenue)}</span>
                  {' ('}
                  <span className={revenue >= breakevenRevenue ? 'text-deep-black' : 'text-wine-red'}>
                    {((revenue / breakevenRevenue) * 100).toFixed(0)}%
                  </span>
                  {')'}
                </div>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-3 flex-wrap">
            <div className={`font-display text-5xl tracking-display leading-none ${valCls}`}>
              {sign}{fmtThbCompact(Math.abs(net))}
            </div>
            <div className="text-xs text-graphite">
              {isCurrent ? `day ${daysPassed} of ${daysInMonth}` : 'final · 12-month closed'}
            </div>
          </div>
          <div className="mt-2 text-[11px] text-graphite font-mono">
            {isCurrent
              ? <>≈ <span className={dailyCls}>{dailyAvg >= 0 ? '+' : '−'}{fmtThbCompact(Math.abs(dailyAvg))}</span> / day so far · proj. EOM <span className={projCls}>{projPos ? '+' : '−'}{fmtThbCompact(Math.abs(netProjected))}</span></>
              : <>{headline.text}</>}
          </div>
        </div>
      </div>

      <div className="px-5 py-4 flex-1">
        <div className="flex items-baseline justify-between mb-2 gap-2">
          <div className="text-[10px] uppercase tracking-overline text-graphite">Inputs</div>
          <Link href="/m/pulse/settings" className="text-[10px] text-graphite hover:text-wine-red">edit fixed costs →</Link>
        </div>
        <div className="space-y-1.5 text-xs">
          <NMORow label="Revenue" value={revenue} sign="+" />
          <NMORow label="B2C" value={revenueB2C} sign="↳" />
          <NMORow label="B2B" value={revenueB2B} sign="↳" />
          {isCurrent && revenueRemainingProj > 0 && (
            <NMORow label="proj. by EOM" value={revenueRemainingProj} sign="↳" signed="+" />
          )}
          <NMORow label="Supplier payments" value={supplierPayments} sign="−"
            sub={isCurrent
              ? (supplierPaymentsRemaining > 0 ? `${fmtThbCompact(supplierPaymentsRemaining)} more due by EOM` : 'all due this month covered')
              : undefined} />
          {supplierConsignment > 0 && (
            <>
              <NMORow label="PO" value={supplierPayments - supplierConsignment} sign="↳" />
              <NMORow label="Consignment" value={supplierConsignment} sign="↳" />
            </>
          )}
          <NMORow label={`Gross Profit · GM% ref ${refGmPct.toFixed(1)}%`} value={gp} sign="=" bold />
          <NMORow label={isCurrent ? `Fixed (${daysPassed}/${daysInMonth} d)` : 'Fixed (full month)'} value={fixedMtd} sign="−" sub={fixedSub} />
          <NMORow label="Net Profit" value={net} sign="=" bold tone={positive ? 'pos' : 'neg'} />
        </div>
      </div>
    </div>
  )
}

function TrendCard({ months, max, selectedYm, annualTotalNet, annualAvgNet, annualTotalRev, annualAvgRev, closedCount }: {
  months: { ym: string; label: string; net: number; revenue: number; supplierPayments: number; fixed: number; isCurrent: boolean }[]
  max: number
  selectedYm: string
  annualTotalNet: number
  annualAvgNet: number
  annualTotalRev: number
  annualAvgRev: number
  closedCount: number
}) {
  // SVG vertical bar chart with zero baseline in the middle. Each bar is a
  // <Link> to filter the Hero/Waterfall into that month.
  // Wider per-bar slot since chart now occupies half-width on desktop.
  const w = 720, h = 230, padX = 8, padTop = 22, padBottom = 22
  const innerW   = w - 2 * padX
  const innerH   = h - padTop - padBottom
  const zeroY    = padTop + innerH / 2
  const halfH    = innerH / 2
  const stepX    = innerW / months.length
  const barW     = stepX * 0.82

  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-4 shadow-card h-full">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div className="font-heading text-sm text-deep-black">Last 12 months + current · net profit</div>
        <div className="text-[10px] text-graphite">click a bar to drill into a month</div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <line x1={padX} y1={zeroY} x2={w - padX} y2={zeroY} stroke="#D4C9BC" strokeWidth={0.5} />

        {months.map((m, i) => {
          const x = padX + i * stepX + (stepX - barW) / 2
          const v = m.net
          const positive = v >= 0
          const bh = Math.min(halfH, (Math.abs(v) / max) * halfH)
          const y  = positive ? zeroY - bh : zeroY
          const fill = positive ? '#3D3D3D' : '#8C1C1C'
          const dash = m.isCurrent ? '3 2' : undefined
          const isSelected = m.ym === selectedYm
          const baseOpacity = m.isCurrent ? 0.45 : 1
          const opacity = isSelected ? 1 : baseOpacity * 0.85
          const valueLabel = `${positive ? '+' : '−'}${fmtThbCompact(Math.abs(m.net))}`
          const valueY = positive ? Math.max(14, y - 4) : Math.min(h - padBottom + 14, y + bh + 12)
          const href = `/m/pulse?month=${m.ym}`
          return (
            <Link key={m.ym} href={href} aria-label={`Drill into ${m.label}`}>
              {/* invisible hit target stretching from top to bottom of inner chart */}
              <rect x={padX + i * stepX} y={padTop} width={stepX} height={innerH} fill="transparent" />
              <rect
                x={x} y={y} width={barW} height={Math.max(0.5, bh)}
                fill={fill} opacity={opacity}
                stroke={isSelected ? '#8C1C1C' : (m.isCurrent ? fill : 'none')}
                strokeWidth={isSelected ? 2 : (m.isCurrent ? 1 : 0)}
                strokeDasharray={dash}
              >
                <title>{`${m.label}\nRevenue ${fmtThbCompact(m.revenue)} · Sup ${fmtThbCompact(m.supplierPayments)} · Fixed ${fmtThbCompact(m.fixed)}\nNet ${valueLabel}${m.isCurrent ? ' (projected)' : ''}`}</title>
              </rect>
              <text
                x={x + barW / 2} y={valueY}
                textAnchor="middle"
                fontSize={10} fill={positive ? '#3D3D3D' : '#8C1C1C'}
                fontFamily="monospace"
                fontWeight={isSelected ? 700 : 400}
                opacity={m.isCurrent ? 0.7 : 1}
              >
                {valueLabel}
              </text>
              <text
                x={x + barW / 2} y={zeroY + halfH + 12}
                textAnchor="middle"
                fontSize={10} fill={isSelected ? '#8C1C1C' : '#3D3D3D'}
                fontFamily="monospace"
                fontWeight={isSelected ? 700 : 400}
              >
                {m.label}
              </text>
            </Link>
          )
        })}
      </svg>

      {/* Trailing-year summary — closed months only, excludes in-progress current. */}
      <div className="mt-3 pt-3 border-t border-pale-stone grid grid-cols-2 gap-4 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">
            Net profit · last {closedCount} months
          </div>
          <div className="flex items-baseline gap-3">
            <div className={`font-display text-2xl tracking-display leading-none ${annualTotalNet >= 0 ? 'text-deep-black' : 'text-wine-red'}`}>
              {annualTotalNet >= 0 ? '+' : '−'}{fmtThbCompact(Math.abs(annualTotalNet))}
            </div>
            <div className="text-graphite text-[11px]">
              avg <span className={annualAvgNet >= 0 ? 'text-deep-black' : 'text-wine-red'}>
                {annualAvgNet >= 0 ? '+' : '−'}{fmtThbCompact(Math.abs(annualAvgNet))}
              </span> / month
            </div>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">
            Revenue · last {closedCount} months
          </div>
          <div className="flex items-baseline gap-3">
            <div className="font-display text-2xl tracking-display text-deep-black leading-none">
              {fmtThbCompact(annualTotalRev)}
            </div>
            <div className="text-graphite text-[11px]">
              avg {fmtThbCompact(annualAvgRev)} / month
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function NextMonthCard({ monthLabel, supplierPaymentsNext, monthlyFixed, monthlyFixedBase, bufferPct, fixedPctOfRevenue, expectedB2BNext, minRevenueNext, minB2CNext }: {
  monthLabel: string
  supplierPaymentsNext: number
  monthlyFixed: number
  monthlyFixedBase: number
  bufferPct: number
  fixedPctOfRevenue: number
  expectedB2BNext: number
  minRevenueNext: number
  minB2CNext: number
}) {
  // Approximate days in the upcoming month — used only for the daily-target
  // breakdown, exact calendar arithmetic not worth it.
  const daysInNextMonth = 30
  const dailyTarget = minB2CNext / daysInNextMonth
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md shadow-card h-full overflow-hidden flex flex-col">
      <div className="flex items-stretch border-b border-pale-stone">
        <div className="bg-amber-gold w-1" />
        <div className="flex-1 px-5 py-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[10px] uppercase tracking-overline text-graphite">Next month · {monthLabel}</div>
            <div className="text-[10px] uppercase tracking-overline text-amber-gold">Break-even target</div>
          </div>
          <div className="mt-2 flex items-baseline gap-3 flex-wrap">
            <div className="font-display text-5xl tracking-display text-deep-black leading-none">
              {fmtThbCompact(minB2CNext)}
            </div>
            <div className="text-xs text-graphite">
              Min B2C revenue to break even
            </div>
          </div>
          <div className="mt-2 text-[11px] text-graphite font-mono">
            ≈ {fmtThbCompact(dailyTarget)} / day over {daysInNextMonth} days
          </div>
        </div>
      </div>

      <div className="px-5 py-4 flex-1">
        <div className="text-[10px] uppercase tracking-overline text-graphite mb-2">Inputs</div>
        <div className="space-y-1.5 text-xs">
          <NMORow label="Supplier payments due" value={supplierPaymentsNext} sign="−"
            sub="POs ordered this month, payable next" />
          <NMORow label="Fixed costs" value={monthlyFixed} sign="−"
            sub={(() => {
              const parts: string[] = []
              if (monthlyFixedBase > 0) parts.push(`${fmtThb(monthlyFixedBase)}/mo + ${(bufferPct * 100).toFixed(0)}% buffer`)
              if (fixedPctOfRevenue > 0) parts.push(`${(fixedPctOfRevenue * 100).toFixed(1)}% of revenue`)
              return parts.length > 0 ? parts.join(' · ') : 'not configured'
            })()} />
          <NMORow label="Min revenue needed" value={minRevenueNext} sign="=" bold />
          <NMORow label="Expected B2B inflow" value={expectedB2BNext} sign="+"
            sub="open FA invoices maturing next month" tone="pos" />
        </div>
      </div>
    </div>
  )
}

function NMORow({ label, value, sign, sub, bold, tone, signed }: {
  label: string; value: number; sign: '+' | '−' | '=' | '↳'
  sub?: string; bold?: boolean; tone?: 'pos' | 'neg'; signed?: '+' | '−'
}) {
  const isSubRow = sign === '↳'
  const valueCls =
    tone === 'neg' ? 'text-wine-red' :
    bold          ? 'text-deep-black font-medium' :
    tone === 'pos' ? 'text-deep-black' :
    isSubRow      ? 'text-graphite/90' :
                    'text-graphite'
  const labelCls =
    bold      ? 'text-deep-black' :
    isSubRow  ? 'text-graphite/80 text-[11px]' :
                'text-graphite'
  const valueStr = `${signed ?? ''}${fmtThb(Math.abs(value))}`
  return (
    <div className={`flex items-baseline gap-2 ${bold ? 'pt-1.5 border-t border-pale-stone/60' : ''} ${isSubRow ? 'pl-3' : ''}`}>
      <span className={`w-3 text-[10px] shrink-0 ${isSubRow ? 'text-graphite/40' : 'text-graphite/60'}`}>{sign}</span>
      <div className="flex-1 min-w-0">
        <div className={labelCls}>{label}</div>
        {sub && <div className="text-[10px] text-graphite/70 mt-0.5">{sub}</div>}
      </div>
      <div className={`tabular-nums text-right ${valueCls} ${isSubRow ? 'text-[11px]' : ''}`}>{valueStr}</div>
    </div>
  )
}

function SettlementsCard(p: {
  view: 'month' | 'total'
  monthLabel: string; isCurrent: boolean
  monthHref: string; totalHref: string
  // this-month
  monthSuppliers: { name: string; total: number; paid: number }[]
  monthSupTotal: number; monthSupPaid: number
  monthCustomers: { name: string; thisMonthTotal: number; thisMonthPaid: number; overdue: number }[]
  monthCustTotal: number; monthCustPaid: number; monthCustOverdue: number; monthB2bIssuedDueNext: number
  // total
  totalSuppliers: { name: string; openTotal: number; dueSoon: number }[]
  totalSupSum: number; totalSupDueSoon: number
  totalCustomers: { name: string; openTotal: number; overdue: number }[]
  totalCustSum: number; totalCustOverdue: number
  arOpen: number; apOpen: number; workingCapital: number
}) {
  const TOP_N = 7
  const isMonth = p.view === 'month'
  const monthTitle = p.isCurrent ? 'this month' : p.monthLabel
  const wcPos = p.workingCapital >= 0

  return (
    <div className="bg-warm-white border border-pale-stone rounded-md shadow-card overflow-hidden">
      {/* Header with tabs */}
      <div className="px-5 py-3 border-b border-pale-stone flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <div className="font-heading text-sm text-deep-black">Settlements</div>
          <div className="flex gap-1 text-[11px]">
            <Link href={p.monthHref} className={`px-2.5 py-1 rounded-sm border transition-colors ${
              isMonth
                ? 'bg-wine-red text-warm-white border-wine-red'
                : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
            }`}>{monthTitle}</Link>
            <Link href={p.totalHref} className={`px-2.5 py-1 rounded-sm border transition-colors ${
              !isMonth
                ? 'bg-wine-red text-warm-white border-wine-red'
                : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
            }`}>total open</Link>
          </div>
        </div>
        {!isMonth && (
          <div className="text-[10px] text-graphite font-mono">
            AR <span className="text-deep-black">+{fmtThbCompact(p.arOpen)}</span>
            {' · '}AP <span className="text-wine-red">−{fmtThbCompact(p.apOpen)}</span>
            {' · '}Net WC <span className={wcPos ? 'text-deep-black' : 'text-wine-red'}>
              {wcPos ? '+' : '−'}{fmtThbCompact(Math.abs(p.workingCapital))}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x divide-pale-stone">
        {isMonth
          ? <MonthSettlements
              suppliers={p.monthSuppliers} supTotal={p.monthSupTotal} supPaid={p.monthSupPaid}
              customers={p.monthCustomers} custTotal={p.monthCustTotal} custPaid={p.monthCustPaid} custOverdue={p.monthCustOverdue}
              custIssuedDueNext={p.monthB2bIssuedDueNext}
              topN={TOP_N} />
          : <TotalSettlements
              suppliers={p.totalSuppliers} supSum={p.totalSupSum} supDueSoon={p.totalSupDueSoon}
              customers={p.totalCustomers} custSum={p.totalCustSum} custOverdue={p.totalCustOverdue}
              topN={TOP_N} />
        }
      </div>
    </div>
  )
}

function MonthSettlements({ suppliers, supTotal, supPaid, customers, custTotal, custPaid, custOverdue, custIssuedDueNext, topN }: {
  suppliers: { name: string; total: number; paid: number }[]
  supTotal: number; supPaid: number
  customers: { name: string; thisMonthTotal: number; thisMonthPaid: number; overdue: number }[]
  custTotal: number; custPaid: number; custOverdue: number; custIssuedDueNext: number
  topN: number
}) {
  const supTop = suppliers.slice(0, topN)
  const supRestSum = suppliers.slice(topN).reduce((s, x) => s + x.total, 0)
  const supRestCount = Math.max(0, suppliers.length - topN)
  const custTop = customers.slice(0, topN)
  const custRestSum = customers.slice(topN).reduce((s, x) => s + x.thisMonthTotal + x.overdue, 0)
  const custRestCount = Math.max(0, customers.length - topN)
  const supRemaining = supTotal - supPaid
  const custRemaining = custTotal - custPaid
  return (
    <>
      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[10px] uppercase tracking-overline text-graphite">Suppliers · we owe</div>
          <div className="text-[10px] text-graphite font-mono">
            <span className="text-deep-black">{fmtThbCompact(supPaid)}</span> paid · <span className="text-wine-red">{fmtThbCompact(supRemaining)}</span> outstanding
          </div>
        </div>
        <div className="space-y-2.5">
          {supTop.length === 0
            ? <div className="text-xs text-graphite py-2">No supplier obligations this month.</div>
            : supTop.map(s => (
                <SettleRow key={s.name} name={s.name} leftValue={s.paid} rightValue={s.total} tone="sup" />
              ))}
          {supRestCount > 0 && (
            <div className="text-[10px] text-graphite pt-1">+ {supRestCount} more · {fmtThbCompact(supRestSum)} total</div>
          )}
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[10px] uppercase tracking-overline text-graphite">B2B customers · they owe us</div>
          <div className="text-[10px] text-graphite font-mono">
            <span className="text-deep-black">{fmtThbCompact(custPaid)}</span> received · <span className="text-graphite">{fmtThbCompact(custRemaining)}</span> outstanding
            {custOverdue > 0 && <> · <span className="text-wine-red">{fmtThbCompact(custOverdue)}</span> overdue</>}
          </div>
        </div>
        {custIssuedDueNext > 0 && (
          <div className="text-[10px] text-graphite mb-2">
            + <span className="text-deep-black font-mono">{fmtThbCompact(custIssuedDueNext)}</span> invoiced this month, due next
          </div>
        )}
        <div className="space-y-2.5">
          {custTop.length === 0
            ? <div className="text-xs text-graphite py-2">No B2B obligations this month.</div>
            : custTop.map(c => (
                <SettleRow key={c.name} name={c.name} leftValue={c.thisMonthPaid} rightValue={c.thisMonthTotal} overdue={c.overdue} tone="cust" />
              ))}
          {custRestCount > 0 && (
            <div className="text-[10px] text-graphite pt-1">+ {custRestCount} more · {fmtThbCompact(custRestSum)} total</div>
          )}
        </div>
      </div>
    </>
  )
}

function TotalSettlements({ suppliers, supSum, supDueSoon, customers, custSum, custOverdue, topN }: {
  suppliers: { name: string; openTotal: number; dueSoon: number }[]
  supSum: number; supDueSoon: number
  customers: { name: string; openTotal: number; overdue: number }[]
  custSum: number; custOverdue: number
  topN: number
}) {
  const supTop  = suppliers.slice(0, topN)
  const supRest = suppliers.slice(topN)
  const custTop  = customers.slice(0, topN)
  const custRest = customers.slice(topN)
  return (
    <>
      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[10px] uppercase tracking-overline text-graphite">Suppliers · open AP</div>
          <div className="text-[10px] text-graphite font-mono">
            <span className="text-wine-red">{fmtThbCompact(supSum)}</span> total
            {supDueSoon > 0 && <> · <span className="text-amber-gold">{fmtThbCompact(supDueSoon)}</span> due ≤ 7d</>}
          </div>
        </div>
        <div className="space-y-2">
          {supTop.length === 0
            ? <div className="text-xs text-graphite py-2">No open supplier balances.</div>
            : supTop.map(s => (
                <TotalRow key={s.name} name={s.name} amount={s.openTotal} sub={s.dueSoon > 0 ? `${fmtThbCompact(s.dueSoon)} due ≤ 7d` : undefined} toneAccent={s.dueSoon > 0} />
              ))}
          {supRest.length > 0 && (
            <div className="text-[10px] text-graphite pt-1">+ {supRest.length} more · {fmtThbCompact(supRest.reduce((s,x)=>s+x.openTotal,0))} total</div>
          )}
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[10px] uppercase tracking-overline text-graphite">B2B customers · open AR</div>
          <div className="text-[10px] text-graphite font-mono">
            <span className="text-deep-black">{fmtThbCompact(custSum)}</span> total
            {custOverdue > 0 && <> · <span className="text-wine-red">{fmtThbCompact(custOverdue)}</span> overdue</>}
          </div>
        </div>
        <div className="space-y-2">
          {custTop.length === 0
            ? <div className="text-xs text-graphite py-2">No open B2B balances.</div>
            : custTop.map(c => (
                <TotalRow key={c.name} name={c.name} amount={c.openTotal} sub={c.overdue > 0 ? `${fmtThbCompact(c.overdue)} overdue` : undefined} toneAccent={c.overdue > 0} />
              ))}
          {custRest.length > 0 && (
            <div className="text-[10px] text-graphite pt-1">+ {custRest.length} more · {fmtThbCompact(custRest.reduce((s,x)=>s+x.openTotal,0))} total</div>
          )}
        </div>
      </div>
    </>
  )
}

function TotalRow({ name, amount, sub, toneAccent }: { name: string; amount: number; sub?: string; toneAccent?: boolean }) {
  return (
    <div className="text-xs flex items-baseline justify-between gap-2">
      <div className="truncate text-deep-black" title={name}>{name}</div>
      <div className="text-right shrink-0">
        <div className="tabular-nums text-deep-black">{fmtThbCompact(amount)}</div>
        {sub && <div className={`text-[10px] ${toneAccent ? 'text-wine-red' : 'text-graphite'}`}>{sub}</div>}
      </div>
    </div>
  )
}

function SettleRow({ name, leftValue, rightValue, overdue, tone }: {
  name: string
  leftValue: number   // paid (or received)
  rightValue: number  // total this month
  overdue?: number
  tone: 'sup' | 'cust'
}) {
  const pct = rightValue > 0 ? Math.min(100, (leftValue / rightValue) * 100) : 0
  const full = rightValue > 0 && leftValue >= rightValue
  const barFill = full
    ? 'bg-graphite/60'
    : tone === 'sup'
      ? 'bg-amber-gold'  // partial payment to supplier — still owe
      : 'bg-graphite/60' // partial received from B2B
  return (
    <div className="text-xs">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="truncate text-deep-black" title={name}>{name}</div>
        <div className="tabular-nums text-[11px] text-graphite font-mono shrink-0">
          {rightValue > 0
            ? <><span className="text-deep-black">{fmtThbCompact(leftValue)}</span> / {fmtThbCompact(rightValue)}</>
            : <span className="text-graphite/60">no due this month</span>}
          {overdue !== undefined && overdue > 0 && (
            <> · <span className="text-wine-red">{fmtThbCompact(overdue)} overdue</span></>
          )}
        </div>
      </div>
      <div className="bg-cream h-1.5 rounded-sm overflow-hidden">
        <div className={`h-full ${barFill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
