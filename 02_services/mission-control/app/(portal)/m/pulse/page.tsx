import Link from 'next/link'
import { sbInventory, sbPublic, type LoyverseReceipt, type FlowInvoice, type B2bCustomer, type Supplier, type PurchaseOrder, type FixedCost } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { DataFreshness } from '@/components/shell/DataFreshness'
import {
  periodRange, previousPeriodRange, trailingDays, type Period,
  AGING_BUCKETS, AGING_LABELS, type AgingBucket, agingBucket,
  computeDueDate, daysBetween, fmtThb, fmtThbCompact, fmtPct,
  fmtDeltaPct, fmtDeltaPp, deltaTone,
  sparkPoints, todayBkk, isoNDaysAgo,
  endOfWeekBkk, endOfMonthBkk, endOfNextMonthBkk,
} from '@/lib/kpi'

export const dynamic = 'force-dynamic'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today',      label: 'Today' },
  { key: 'wtd',        label: 'WTD' },
  { key: 'mtd',        label: 'MTD' },
  { key: 'last_month', label: 'Last month' },
]

type SearchParams = { period?: Period }

// ════════════════════════════════════════════════════════════════════════════
// Page
// ════════════════════════════════════════════════════════════════════════════

export default async function PulsePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const period: Period = (PERIODS.find(p => p.key === sp.period)?.key) ?? 'mtd'
  const range  = periodRange(period)
  const prev   = previousPeriodRange(period)
  const trend  = trailingDays(30)
  const today  = todayBkk()

  // ─── Fetch all source data in parallel ────────────────────────────────────
  const [
    receiptsPeriodRes,
    receiptsPrevRes,
    receiptsTrendRes,
    invoicesOpenRes,
    invoicesPeriodRes,
    invoicesPrevRes,
    receiptsFaPeriodRes,
    customersRes,
    suppliersRes,
    posOpenRes,
    fixedCostsRes,
  ] = await Promise.all([
    sbInventory
      .from('loyverse_receipt')
      .select('total, cost_total, is_b2b, receipt_type, receipt_date')
      .gte('receipt_date', range.fromISO)
      .lt('receipt_date', range.toISO),
    sbInventory
      .from('loyverse_receipt')
      .select('total, cost_total, is_b2b, receipt_type')
      .gte('receipt_date', prev.fromISO)
      .lt('receipt_date', prev.toISO),
    sbInventory
      .from('loyverse_receipt')
      .select('total, cost_total, is_b2b, receipt_type, receipt_date')
      .gte('receipt_date', trend.fromISO)
      .lt('receipt_date', trend.toISO),
    sbInventory
      .from('flowaccount_invoice')
      .select('id, number, customer_id, customer_name, issued_at, due_at, status, total, detail_url')
      .neq('status', 'Cancelled')
      .eq('excluded', false),
    sbInventory
      .from('flowaccount_invoice')
      .select('total')
      .neq('status', 'Cancelled')
      .eq('excluded', false)
      .gte('issued_at', range.fromDate)
      .lt('issued_at', range.toDate),
    sbInventory
      .from('flowaccount_invoice')
      .select('total')
      .neq('status', 'Cancelled')
      .eq('excluded', false)
      .gte('issued_at', prev.fromDate)
      .lt('issued_at', prev.toDate),
    sbInventory
      .from('flowaccount_receipt')
      .select('amount, paid_at')
      .gte('paid_at', range.fromDate)
      .lt('paid_at', range.toDate),
    sbInventory
      .from('b2b_customer')
      .select('id, flowaccount_name, payment_terms_days'),
    sbInventory
      .from('supplier')
      .select('name, type, payment_terms_days'),
    sbPublic
      .from('purchase_orders')
      .select('id, po_number, supplier, total_thb, order_date, cashflow_override, url')
      .gte('order_date', isoNDaysAgo(90)),
    sbInventory
      .from('fixed_cost')
      .select('amount_thb, active'),
  ])

  for (const r of [receiptsPeriodRes, receiptsPrevRes, receiptsTrendRes, invoicesOpenRes, invoicesPeriodRes, invoicesPrevRes, receiptsFaPeriodRes, customersRes, suppliersRes]) {
    if (r.error) return <div className="p-6"><SchemaError error={r.error.message} /></div>
  }
  if (posOpenRes.error) return <div className="p-6"><SchemaError error={posOpenRes.error.message} /></div>
  // fixed_cost is allowed to be missing (migration not applied yet) — treat as empty list.

  // ─── Sales / COGS / GP (Loyverse receipts) ────────────────────────────────
  const receipts = (receiptsPeriodRes.data ?? []) as LoyverseReceipt[]
  const agg = aggregateReceipts(receipts)
  const prevAgg = aggregateReceipts((receiptsPrevRes.data ?? []) as LoyverseReceipt[])
  const grossMarginPct     = agg.netSales     > 0 ? (agg.grossProfit     / agg.netSales)     * 100 : 0
  const prevGrossMarginPct = prevAgg.netSales > 0 ? (prevAgg.grossProfit / prevAgg.netSales) * 100 : 0

  // ─── B2B Credit vs Cash split ─────────────────────────────────────────────
  const b2bCredit     = (invoicesPeriodRes.data ?? []).reduce((s: number, i: any) => s + Number(i.total), 0)
  const b2bCreditPrev = (invoicesPrevRes.data   ?? []).reduce((s: number, i: any) => s + Number(i.total), 0)
  const b2bCash       = Math.max(0, agg.b2bSales     - b2bCredit)
  const collections   = (receiptsFaPeriodRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0)

  // ─── AR Open / Overdue / Aging (FA invoices, all-time open) ───────────────
  const customers = (customersRes.data ?? []) as B2bCustomer[]
  const termsByCustomer = new Map(customers.map(c => [c.id, c.payment_terms_days ?? 0]))
  const nameByCustomer  = new Map(customers.map(c => [c.id, c.flowaccount_name]))
  const openInvoices = ((invoicesOpenRes.data ?? []) as FlowInvoice[]).filter(i => i.status !== 'Paid')

  type EnrichedInv = { inv: FlowInvoice; dueAt: string; daysOverdue: number; bucket: AgingBucket }
  const enriched: EnrichedInv[] = openInvoices.map(inv => {
    const terms = inv.customer_id ? (termsByCustomer.get(inv.customer_id) ?? 0) : 0
    const dueAt = inv.due_at ?? (terms > 0 ? computeDueDate(inv.issued_at, terms) : inv.issued_at)
    const daysOverdue = daysBetween(today, dueAt)
    return { inv, dueAt, daysOverdue, bucket: agingBucket(daysOverdue) }
  })

  const arOpen = enriched.reduce((s, e) => s + Number(e.inv.total), 0)
  const arOverdue = enriched.filter(e => e.daysOverdue > 0).reduce((s, e) => s + Number(e.inv.total), 0)
  const agingByBucket: Record<AgingBucket, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
  for (const e of enriched) agingByBucket[e.bucket] += Number(e.inv.total)

  // Open AR with due_date in [today, end of this week] — used by Cash Pressure proxy.
  // Overdue AR is intentionally excluded: it should have been collected already;
  // betting on it for the week's inflow would over-state expected cash.
  const _eow = endOfWeekBkk()
  const arDueThisWeek = enriched
    .filter(e => e.dueAt >= today && e.dueAt <= _eow)
    .reduce((s, e) => s + Number(e.inv.total), 0)

  // Aggregate overdue by customer for the action table.
  const overdueByCustomer = new Map<string, { customer: string; total: number; count: number; maxDays: number; lastInvoice: string }>()
  for (const e of enriched) {
    if (e.daysOverdue <= 0) continue
    const key = e.inv.customer_name || nameByCustomer.get(e.inv.customer_id ?? '') || '(unknown)'
    const cur = overdueByCustomer.get(key) ?? { customer: key, total: 0, count: 0, maxDays: 0, lastInvoice: '' }
    cur.total += Number(e.inv.total)
    cur.count += 1
    if (e.daysOverdue > cur.maxDays) cur.maxDays = e.daysOverdue
    if (e.inv.issued_at > cur.lastInvoice) cur.lastInvoice = e.inv.issued_at
    overdueByCustomer.set(key, cur)
  }
  const topOverdueCustomers = [...overdueByCustomer.values()].sort((a, b) => b.total - a.total).slice(0, 5)

  // ─── Supplier AP ──────────────────────────────────────────────────────────
  // Payment due date = order_date + 30d for every PO (universal grace period
  // per ops policy — supplier-specific terms ignored). Older-than-14d-past-due
  // POs assumed paid (manual paid_at is unreliable). Calendar-based buckets
  // make AP read like a payment schedule, not an abstract aging report.
  const AP_TERM_DAYS  = 30
  const AP_GRACE_DAYS = 14
  const endOfWeek      = endOfWeekBkk()
  const endOfMonth     = endOfMonthBkk()
  const endOfNextMonth = endOfNextMonthBkk()

  type SupRow = Pick<Supplier, 'name' | 'type'>
  const suppliers = (suppliersRes.data ?? []) as SupRow[]
  const supByName = new Map(suppliers.map(s => [s.name.trim().toLowerCase(), s]))
  function supFor(name: string | null): SupRow | undefined {
    return name ? supByName.get(name.trim().toLowerCase()) : undefined
  }
  function includedInCashflow(p: Pick<PurchaseOrder, 'cashflow_override' | 'supplier'>): boolean {
    if (p.cashflow_override === 'exclude') return false
    if (p.cashflow_override === 'include') return true
    return (supFor(p.supplier)?.type ?? 'regular') !== 'consignment'
  }

  const allPOs = ((posOpenRes.data ?? []) as PurchaseOrder[]).filter(includedInCashflow)

  type DueRow = { id: number; po: string; supplier: string; total: number; dueAt: string; daysUntilDue: number; url: string | null }
  const dueRows: DueRow[] = allPOs
    .filter(p => p.order_date)
    .map(p => {
      const dueAt = computeDueDate(p.order_date!, AP_TERM_DAYS)
      return {
        id: p.id, po: p.po_number, supplier: p.supplier ?? '(unknown)',
        total: Number(p.total_thb ?? 0),
        dueAt,
        daysUntilDue: daysBetween(dueAt, today),
        url: p.url,
      }
    })
    .filter(d => d.daysUntilDue >= -AP_GRACE_DAYS)

  const apOpen     = dueRows.reduce((s, d) => s + d.total, 0)
  const apThisWeek = dueRows.filter(d => d.dueAt <= endOfWeek).reduce((s, d) => s + d.total, 0)
  const apThisMonth = dueRows.filter(d => d.dueAt <= endOfMonth).reduce((s, d) => s + d.total, 0)

  // Aggregate suppliers due soon (sum across multiple POs for the same supplier).
  const supDueAgg = new Map<string, { supplier: string; total: number; count: number; minDays: number }>()
  for (const d of dueRows) {
    const cur = supDueAgg.get(d.supplier) ?? { supplier: d.supplier, total: 0, count: 0, minDays: Infinity }
    cur.total += d.total
    cur.count += 1
    if (d.daysUntilDue < cur.minDays) cur.minDays = d.daysUntilDue
    supDueAgg.set(d.supplier, cur)
  }
  const topSuppliersDue = [...supDueAgg.values()].sort((a, b) => a.minDays - b.minDays).slice(0, 5)

  type ApBucket = 'Overdue' | 'Today' | 'This week' | 'This month' | 'Next month' | 'Later'
  const apBuckets: Record<ApBucket, number> = { 'Overdue': 0, 'Today': 0, 'This week': 0, 'This month': 0, 'Next month': 0, 'Later': 0 }
  for (const d of dueRows) {
    if (d.daysUntilDue < 0)               apBuckets['Overdue']    += d.total
    else if (d.daysUntilDue === 0)        apBuckets['Today']      += d.total
    else if (d.dueAt <= endOfWeek)        apBuckets['This week']  += d.total
    else if (d.dueAt <= endOfMonth)       apBuckets['This month'] += d.total
    else if (d.dueAt <= endOfNextMonth)   apBuckets['Next month'] += d.total
    else                                   apBuckets['Later']      += d.total
  }

  // ─── Sales / GP trend (30 days, for combo chart and sparklines) ───────────
  type DayBucket = { day: string; b2c: number; b2b: number; cost: number }
  const trendByDay = new Map<string, DayBucket>()
  for (const d of trend.days) trendByDay.set(d, { day: d, b2c: 0, b2b: 0, cost: 0 })
  for (const r of (receiptsTrendRes.data ?? []) as LoyverseReceipt[]) {
    const day = r.receipt_date.slice(0, 10)
    const cell = trendByDay.get(day); if (!cell) continue
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const total = Number(r.total) * sign
    const cost  = Number(r.cost_total ?? 0) * sign
    if (r.is_b2b) cell.b2b += total; else cell.b2c += total
    cell.cost += cost
  }
  const trendData = trend.days.map(d => trendByDay.get(d)!)
  const trendTotals = trendData.map(d => d.b2c + d.b2b)
  const trendGP     = trendData.map(d => (d.b2c + d.b2b) - d.cost)
  const trendMargin = trendData.map(d => {
    const t = d.b2c + d.b2b
    return t > 0 ? ((t - d.cost) / t) * 100 : 0
  })

  // ─── Operating health: break-even + COGS coverage ────────────────────────
  // Monthly fixed costs are user-edited on /m/pulse/settings. Daily break-even
  // is monthly / 30 / trailing-30d GM%. Using trailing GM% (not period GM%)
  // keeps BE stable when the user switches the period filter.
  const fixedCostRows = ((fixedCostsRes.data ?? []) as Pick<FixedCost, 'amount_thb' | 'active'>[])
  const monthlyFixed  = fixedCostRows.filter(r => r.active).reduce((s, r) => s + Number(r.amount_thb), 0)

  const trend30Sales  = trendData.reduce((s, d) => s + d.b2c + d.b2b, 0)
  const trend30Cost   = trendData.reduce((s, d) => s + d.cost, 0)
  const trend30GMPct  = trend30Sales > 0 ? ((trend30Sales - trend30Cost) / trend30Sales) * 100 : 0
  const dailyBE: number | null = (monthlyFixed > 0 && trend30GMPct > 0)
    ? monthlyFixed / 30 / (trend30GMPct / 100)
    : null

  const todayRevenue = trendData[trendData.length - 1] ? (trendData[trendData.length - 1].b2c + trendData[trendData.length - 1].b2b) : 0
  const mtdDays      = trendData.filter(d => d.day >= todayBkk().slice(0, 8) + '01')   // YYYY-MM-01 → today
  const daysAboveBE  = dailyBE != null ? mtdDays.filter(d => (d.b2c + d.b2b) >= dailyBE).length : 0

  // COGS coverage: project current-month COGS at MTD pace to a full month, then
  // compare to previous calendar month PO total (regular suppliers only).
  // > 1.0 = selling faster than purchasing; < 1.0 = cash burn flag.
  const todayD       = new Date(today + 'T00:00:00Z')
  const daysInMonth  = new Date(Date.UTC(todayD.getUTCFullYear(), todayD.getUTCMonth() + 1, 0)).getUTCDate()
  const daysPassed   = todayD.getUTCDate()
  const mtdCOGS      = mtdDays.reduce((s, d) => s + d.cost, 0)
  const projectedCOGS = daysPassed > 0 ? (mtdCOGS / daysPassed) * daysInMonth : 0

  const pmFrom = new Date(Date.UTC(todayD.getUTCFullYear(), todayD.getUTCMonth() - 1, 1)).toISOString().slice(0, 10)
  const pmTo   = new Date(Date.UTC(todayD.getUTCFullYear(), todayD.getUTCMonth(),     1)).toISOString().slice(0, 10)
  const prevMonthPOTotal = allPOs
    .filter(p => p.order_date && p.order_date >= pmFrom && p.order_date < pmTo)
    .reduce((s, p) => s + Number(p.total_thb ?? 0), 0)
  const coverage: number | null = prevMonthPOTotal > 0 ? projectedCOGS / prevMonthPOTotal : null

  // ─── Cash Pressure this week (proxy) ──────────────────────────────────────
  // Window = today → end of current calendar week (Mon-Sun). Cash in =
  // trailing-7d Loyverse revenue × (days remaining / 7) + AR due this week.
  // Cash out = AP due this week (overdue + today + rest of the week).
  // Pressure = out − in.
  const daysRemainingThisWeek = Math.max(1, daysBetween(endOfWeek, today) + 1)
  const runRate7d          = trendData.slice(-7).reduce((s, d) => s + d.b2c + d.b2b, 0)
  const runRateRemaining   = runRate7d * (daysRemainingThisWeek / 7)
  const expectedCashInWeek = runRateRemaining + arDueThisWeek
  const cashPressureWeek   = apThisWeek - expectedCashInWeek

  // ─── Auto-generated insight banner ────────────────────────────────────────
  const arOverduePct = arOpen > 0 ? (arOverdue / arOpen) * 100 : 0
  const insight = buildInsight({
    netSales: agg.netSales, netSalesPrev: prevAgg.netSales,
    grossMarginPct, prevGrossMarginPct,
    cashPressureWeek, apThisWeek, expectedCashInWeek,
    arOverduePct, arOverdue,
    topOverdueCount: topOverdueCustomers.length,
  })

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">Finance Pulse · {range.label}</h2>
        <div className="flex items-center gap-3">
          <Link
            href="/m/pulse/settings"
            className="text-[11px] text-graphite hover:text-wine-red font-mono"
            title="Edit monthly fixed costs"
          >
            ⚙ Settings
          </Link>
          <DataFreshness sources={['loyverse_stock', 'flowaccount_invoices', 'flowaccount_receipts', 'purchase_orders']} />
        </div>
      </div>

      {/* Period filter */}
      <div className="flex gap-1 text-xs mb-4">
        {PERIODS.map(p => {
          const active = p.key === period
          const params = new URLSearchParams()
          if (p.key !== 'mtd') params.set('period', p.key)
          const qs = params.toString()
          return (
            <Link key={p.key}
              href={qs ? `/m/pulse?${qs}` : '/m/pulse'}
              className={`px-3 py-1.5 rounded-sm border transition-colors ${
                active
                  ? 'bg-wine-red text-warm-white border-wine-red'
                  : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red hover:text-wine-red'
              }`}>
              {p.label}
            </Link>
          )
        })}
      </div>

      {/* ─── Summary banner ─────────────────────────────────────────────── */}
      <SummaryBanner insight={insight} />

      {/* ─── Risk strip ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <RiskChip
          label="AR overdue share"
          value={`${arOverduePct.toFixed(0)}%`}
          sub={`${fmtThb(arOverdue)} of ${fmtThb(arOpen)}`}
          tone={arOverduePct >= 30 ? 'danger' : arOverduePct > 0 ? 'warn' : 'ok'}
        />
        <RiskChip
          label="Cash pressure · this week"
          value={fmtThbCompact(cashPressureWeek)}
          sub={`${fmtThbCompact(apThisWeek)} out − ${fmtThbCompact(expectedCashInWeek)} in (run-rate + AR)`}
          tone={cashPressureWeek > 0 ? 'danger' : 'ok'}
          tooltip="Phase 1 proxy: AP due by end of this calendar week (Mon-Sun) minus expected cash inflow (trailing Loyverse run-rate prorated for days remaining + open AR due this week). Assumes run-rate continues and 100% on-time collection of due AR."
        />
        <RiskChip
          label="Reconciliation"
          value="Not enabled"
          sub="Matcher ships in Phase 2"
          tone="muted"
        />
      </div>

      {/* ─── Row 1: 4 hero KPI ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <HeroKpi
          label="Net Sales"
          value={fmtThbCompact(agg.netSales)}
          delta={fmtDeltaPct(agg.netSales, prevAgg.netSales)}
          deltaTone={deltaTone(agg.netSales, prevAgg.netSales, 'good')}
          deltaSub={`vs ${prev.label}`}
          spark={trendTotals}
          sparkColor="#3D3D3D"
        />
        <HeroKpi
          label="Gross Profit"
          value={fmtThbCompact(agg.grossProfit)}
          delta={fmtDeltaPct(agg.grossProfit, prevAgg.grossProfit)}
          deltaTone={deltaTone(agg.grossProfit, prevAgg.grossProfit, 'good')}
          deltaSub={`vs ${prev.label}`}
          spark={trendGP}
          sparkColor="#8C1C1C"
        />
        <HeroKpi
          label="Gross Margin %"
          value={`${grossMarginPct.toFixed(1)}%`}
          delta={fmtDeltaPp(grossMarginPct, prevGrossMarginPct)}
          deltaTone={deltaTone(grossMarginPct, prevGrossMarginPct, 'good')}
          deltaSub={`vs ${prev.label}`}
          spark={trendMargin}
          sparkColor="#C9A84C"
        />
        <HeroKpi
          label="Cash Pressure · this week"
          value={fmtThbCompact(cashPressureWeek)}
          badge="proxy"
          delta={cashPressureWeek > 0 ? 'Net outflow' : cashPressureWeek < 0 ? 'Net inflow' : 'Balanced'}
          deltaTone={cashPressureWeek > 0 ? 'neg' : cashPressureWeek < 0 ? 'pos' : 'flat'}
          deltaSub={`out ${fmtThbCompact(apThisWeek)} · in ${fmtThbCompact(expectedCashInWeek)}`}
          tooltip="Phase 1 proxy: AP due by end of this calendar week (Mon-Sun) minus expected cash inflow (trailing Loyverse run-rate prorated for days remaining + open AR due this week). Assumes run-rate continues and 100% on-time collection of due AR."
        />
      </div>

      {/* ─── Operating Health row: break-even + coverage ─────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <BreakEvenTodayCard dailyBE={dailyBE} todayRevenue={todayRevenue} monthlyFixed={monthlyFixed} />
        <DaysAboveBECard dailyBE={dailyBE} daysAboveBE={daysAboveBE} daysPassed={Math.max(1, mtdDays.length)} />
        <CoverageCard
          coverage={coverage}
          mtdCOGS={mtdCOGS}
          projectedCOGS={projectedCOGS}
          prevMonthPOTotal={prevMonthPOTotal}
        />
      </div>

      {/* ─── Row 2: B2B / obligations breakdown ─────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <MiniKpi label="B2B Sales"      value={fmtThbCompact(agg.b2bSales)}  sub={fmtPct(agg.b2bSales, agg.netSales) + ' of total'} />
        <MiniKpi label="B2B Cash"       value={fmtThbCompact(b2bCash)}       sub="immediate payment" approx />
        <MiniKpi label="Invoiced on credit" value={fmtThbCompact(b2bCredit)} sub={fmtDeltaPct(b2bCredit, b2bCreditPrev) + ' vs prev'} />
        <MiniKpi label="B2B AR Open"    value={fmtThbCompact(arOpen)}        sub={`${openInvoices.length} open invoices`} />
        <MiniKpi label="B2B AR Overdue" value={fmtThbCompact(arOverdue)}     sub={`${fmtPct(arOverdue, arOpen)} of open`} alert={arOverdue > 0} />
        <MiniKpi label="Supplier payables" value={fmtThbCompact(apOpen)}     sub={`${dueRows.length} active PO`} />
      </div>

      {/* ─── Charts row: Sales+GP combo (6) | AR Aging (3) | AP buckets (3) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-3">
        <div className="lg:col-span-6">
          <Card
            title="Sales + Gross Profit · last 30 days"
            right={<div className="flex gap-3 text-[10px] text-graphite flex-wrap">
              <LegendDot color="#3D3D3D" label="≥ BE" />
              <LegendDot color="#8C1C1C" label="< BE" />
              <LegendDot color="#8C1C1C" label="GP" line />
              {dailyBE != null && <LegendDot color="#C9A84C" label="BE line" line dashed />}
            </div>}
          >
            <ComboChart days={trend.days} sales={trendTotals} gp={trendGP} breakEven={dailyBE} />
            <div className="flex justify-between mt-2 text-[10px] text-graphite font-mono">
              <span>{trend.days[0]?.slice(5)}</span>
              <span>Total: {fmtThb(trendTotals.reduce((s, v) => s + v, 0))} · avg/day {fmtThb(trendTotals.reduce((s, v) => s + v, 0) / Math.max(1, trendTotals.length))}</span>
              <span>{trend.days[trend.days.length - 1]?.slice(5)}</span>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card title="AR Aging" right={<span className="text-[10px] text-graphite">{fmtThb(arOverdue)} · {arOverduePct.toFixed(0)}% overdue</span>}>
            <div className="space-y-2">
              {AGING_BUCKETS.map(b => {
                const v = agingByBucket[b]
                const pct = arOpen > 0 ? (v / arOpen) * 100 : 0
                return (
                  <div key={b} className="flex items-center gap-2 text-xs">
                    <div className="w-14 text-graphite shrink-0">{AGING_LABELS[b]}</div>
                    <div className="flex-1 bg-cream rounded-sm h-4 overflow-hidden">
                      <div className={`h-full ${AGING_COLOR[b]}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-12 text-right tabular-nums text-graphite text-[10px]">{pct.toFixed(0)}%</div>
                    <div className="w-16 text-right tabular-nums text-deep-black text-[11px]">{fmtThbCompact(v)}</div>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card
            title="AP Due Buckets"
            right={<span className="text-[10px] text-graphite">{fmtThb(apOpen)} · {fmtThbCompact(apThisWeek)} this week</span>}
          >
            <div className="space-y-2">
              {(Object.keys(apBuckets) as (keyof typeof apBuckets)[]).map(b => {
                const v = apBuckets[b]
                const pct = apOpen > 0 ? (v / apOpen) * 100 : 0
                return (
                  <div key={b} className="flex items-center gap-2 text-xs">
                    <div className="w-20 text-graphite shrink-0">{b}</div>
                    <div className="flex-1 bg-cream rounded-sm h-4 overflow-hidden">
                      <div className={`h-full ${AP_COLOR[b]}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-12 text-right tabular-nums text-graphite text-[10px]">{pct.toFixed(0)}%</div>
                    <div className="w-16 text-right tabular-nums text-deep-black text-[11px]">{fmtThbCompact(v)}</div>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      </div>

      {/* ─── Action tables row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-3">
        <div className="lg:col-span-4">
          <Card title="Top overdue B2B clients" right={<span className="text-[10px] text-graphite">by amount</span>}>
            {topOverdueCustomers.length === 0
              ? <div className="text-xs text-graphite py-6 text-center">Nothing overdue 🎉</div>
              : <table className="w-full text-[11px]">
                  <thead className="text-graphite border-b border-pale-stone">
                    <tr>
                      <th className="py-1.5 text-left font-normal">Customer</th>
                      <th className="py-1.5 text-right font-normal">Overdue</th>
                      <th className="py-1.5 text-right font-normal">Inv</th>
                      <th className="py-1.5 text-right font-normal">Max days</th>
                      <th className="py-1.5 text-right font-normal" title="Manual workflow field. Will become editable in Phase 2.">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topOverdueCustomers.map(c => (
                      <tr key={c.customer} className="border-b border-pale-stone/40 last:border-0">
                        <td className="py-1.5 truncate max-w-[10rem]" title={c.customer}>{c.customer}</td>
                        <td className="py-1.5 text-right tabular-nums text-deep-black">{fmtThbCompact(c.total)}</td>
                        <td className="py-1.5 text-right tabular-nums text-graphite">{c.count}</td>
                        <td className="py-1.5 text-right tabular-nums text-wine-red">{c.maxDays}d</td>
                        <td className="py-1.5 text-right"><PhaseBadge /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </Card>
        </div>

        <div className="lg:col-span-4">
          <Card title="Top suppliers due soon" right={<span className="text-[10px] text-graphite">next by due</span>}>
            {topSuppliersDue.length === 0
              ? <div className="text-xs text-graphite py-6 text-center">No upcoming AP</div>
              : <table className="w-full text-[11px]">
                  <thead className="text-graphite border-b border-pale-stone">
                    <tr>
                      <th className="py-1.5 text-left font-normal">Supplier</th>
                      <th className="py-1.5 text-right font-normal">Amount</th>
                      <th className="py-1.5 text-right font-normal">PO</th>
                      <th className="py-1.5 text-right font-normal">Days</th>
                      <th className="py-1.5 text-right font-normal" title="Manual workflow field. Will become editable in Phase 2.">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSuppliersDue.map(d => (
                      <tr key={d.supplier} className="border-b border-pale-stone/40 last:border-0">
                        <td className="py-1.5 truncate max-w-[10rem]" title={d.supplier}>{d.supplier}</td>
                        <td className="py-1.5 text-right tabular-nums text-deep-black">{fmtThbCompact(d.total)}</td>
                        <td className="py-1.5 text-right tabular-nums text-graphite">{d.count}</td>
                        <td className="py-1.5 text-right tabular-nums text-graphite">{d.minDays < 0 ? `${-d.minDays}d late` : `+${d.minDays}d`}</td>
                        <td className="py-1.5 text-right"><PhaseBadge /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </Card>
        </div>

        <div className="lg:col-span-4">
          <Card title="Reconciliation issues" right={<span className="text-[10px] text-graphite uppercase tracking-overline">Phase 2</span>}>
            <div className="flex flex-col items-center justify-center py-6 text-center gap-1">
              <div className="font-display text-2xl tracking-display text-graphite">Not enabled</div>
              <div className="text-[11px] text-graphite max-w-[16rem]">
                Payment-to-invoice matcher ships in Phase 2. It will surface unmatched bank transfers,
                FA receipts without Loyverse payment, and split / over-allocated payments here.
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ─── Methodology drawer ─────────────────────────────────────────── */}
      <details className="mt-3 bg-warm-white border border-pale-stone rounded-md text-xs">
        <summary className="cursor-pointer px-4 py-2 text-graphite hover:text-wine-red list-none flex items-center gap-1">
          <span className="text-pale-stone">▸</span> Methodology &amp; data sources
        </summary>
        <div className="px-4 pb-4 pt-1 text-graphite space-y-2 leading-relaxed">
          <p><span className="text-deep-black">Sales / COGS / GP</span> — Loyverse receipts (source of truth for revenue &amp; cost). B2B vs B2C uses the shared classifier (<code className="font-mono text-[10px]">03_automation/lib/b2b.ts</code>): bank-transfer payment OR customer name match.</p>
          <p><span className="text-deep-black">B2B Credit Sales</span> — sum of FlowAccount tax invoices issued in period (status ≠ Cancelled, not excluded). <span className="text-deep-black">B2B Cash Sales</span> — B2B Sales − B2B Credit Sales, clamped to ≥ 0. Approximate until the payment-to-invoice matcher ships (Phase 2).</p>
          <p><span className="text-deep-black">AR Open / Overdue / Aging</span> — open FA invoices (not Paid, not Cancelled, not excluded). Due date = invoice.due_at, falling back to issued_at + customer.payment_terms_days.</p>
          <p><span className="text-deep-black">Supplier AP</span> — PO with order_date in last 90 days. Payment due = order_date + {AP_TERM_DAYS}d (universal grace per ops policy; supplier-specific terms ignored). AP Open = POs whose due date is within {AP_GRACE_DAYS}d grace of today or in the future; older POs assumed paid (manual paid_at is unreliable). Buckets are calendar-based (Today / This week / This month / Next month).</p>
          <p><span className="text-deep-black">Cash Pressure · this week</span> — proxy: AP due by end of this calendar week (Mon-Sun) minus expected cash inflow. Expected inflow = trailing Loyverse run-rate prorated for days remaining + open AR due this week (assumes 100% on-time collection). Treat as operational pressure indicator, not a true cash forecast.</p>
        </div>
      </details>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Aggregation helpers
// ════════════════════════════════════════════════════════════════════════════

function aggregateReceipts(rows: Pick<LoyverseReceipt, 'total' | 'cost_total' | 'is_b2b' | 'receipt_type'>[]) {
  let netSales = 0, b2cSales = 0, b2bSales = 0, cogs = 0
  for (const r of rows) {
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const total = Number(r.total) * sign
    const cost  = Number(r.cost_total ?? 0) * sign
    netSales += total
    cogs += cost
    if (r.is_b2b) b2bSales += total; else b2cSales += total
  }
  return { netSales, b2cSales, b2bSales, cogs, grossProfit: netSales - cogs }
}

function buildInsight(p: {
  netSales: number; netSalesPrev: number
  grossMarginPct: number; prevGrossMarginPct: number
  cashPressureWeek: number; apThisWeek: number; expectedCashInWeek: number
  arOverduePct: number; arOverdue: number
  topOverdueCount: number
}): { tone: 'ok' | 'warn' | 'danger'; text: string } {
  const flags: string[] = []
  let tone: 'ok' | 'warn' | 'danger' = 'ok'

  if (p.cashPressureWeek > 0) {
    flags.push(`supplier payments this week exceed expected cash inflow by ${fmtThbCompact(p.cashPressureWeek)}`)
    tone = 'danger'
  }
  if (p.arOverduePct >= 30) {
    flags.push(`${p.arOverduePct.toFixed(0)}% of B2B AR is overdue (${fmtThbCompact(p.arOverdue)})`)
    tone = tone === 'danger' ? 'danger' : 'warn'
  }
  const marginDeltaPp = p.grossMarginPct - p.prevGrossMarginPct
  if (marginDeltaPp < -3 && p.netSalesPrev > 0) {
    flags.push(`margin down ${marginDeltaPp.toFixed(1)} pp vs previous period`)
    tone = tone === 'danger' ? 'danger' : 'warn'
  }
  const salesDeltaPct = p.netSalesPrev > 0 ? ((p.netSales - p.netSalesPrev) / p.netSalesPrev) * 100 : 0
  if (salesDeltaPct < -15 && p.netSalesPrev > 0) {
    flags.push(`sales down ${Math.abs(salesDeltaPct).toFixed(0)}% vs previous period`)
    tone = tone === 'danger' ? 'danger' : 'warn'
  }

  if (flags.length === 0) {
    return { tone: 'ok', text: 'Margin healthy, AR under control, no cash pressure this week.' }
  }
  const head = tone === 'danger' ? 'Action needed' : 'Watch this'
  return { tone, text: `${head}: ${flags.join('; ')}.` }
}

// ════════════════════════════════════════════════════════════════════════════
// UI atoms
// ════════════════════════════════════════════════════════════════════════════

function SummaryBanner({ insight }: { insight: { tone: 'ok' | 'warn' | 'danger'; text: string } }) {
  const tone = insight.tone
  const bar  = tone === 'danger' ? 'bg-wine-red'   : tone === 'warn' ? 'bg-amber-gold' : 'bg-graphite/30'
  const icon = tone === 'danger' ? '!' : tone === 'warn' ? '·' : '✓'
  const iconBg = tone === 'danger' ? 'bg-wine-red text-warm-white' : tone === 'warn' ? 'bg-amber-gold text-deep-black' : 'bg-graphite/20 text-graphite'
  return (
    <div className="flex items-stretch mb-3 bg-warm-white border border-pale-stone rounded-md overflow-hidden shadow-card">
      <div className={`${bar} w-1`} />
      <div className="flex-1 flex items-center gap-3 px-4 py-3">
        <div className={`${iconBg} w-6 h-6 rounded-full flex items-center justify-center font-display text-sm shrink-0`}>{icon}</div>
        <div className="flex-1 text-sm text-deep-black">{insight.text}</div>
      </div>
    </div>
  )
}

function RiskChip({ label, value, sub, tone, tooltip }: {
  label: string; value: string; sub: string
  tone: 'ok' | 'warn' | 'danger' | 'muted'
  tooltip?: string
}) {
  const valCls = tone === 'danger' ? 'text-wine-red' : tone === 'warn' ? 'text-amber-gold' : tone === 'ok' ? 'text-deep-black' : 'text-graphite'
  const dotCls = tone === 'danger' ? 'bg-wine-red'   : tone === 'warn' ? 'bg-amber-gold'   : tone === 'ok' ? 'bg-graphite/30'  : 'bg-pale-stone'
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-3 shadow-card flex items-center gap-3" title={tooltip}>
      <div className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-overline text-graphite truncate">{label}</div>
        <div className="text-[11px] text-graphite truncate" title={sub}>{sub}</div>
      </div>
      <div className={`font-display text-2xl tracking-display leading-none ${valCls}`}>{value}</div>
    </div>
  )
}

function HeroKpi({ label, value, delta, deltaTone, deltaSub, spark, sparkColor, badge, tooltip }: {
  label: string; value: string
  delta: string; deltaTone: 'pos' | 'neg' | 'flat'; deltaSub: string
  spark?: number[]; sparkColor?: string
  badge?: string; tooltip?: string
}) {
  const deltaCls = deltaTone === 'pos' ? 'text-graphite' : deltaTone === 'neg' ? 'text-wine-red' : 'text-graphite/60'
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-4 shadow-card" title={tooltip}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[10px] uppercase tracking-overline text-graphite truncate">{label}</div>
        {badge && (
          <span className="text-[9px] font-mono uppercase tracking-overline text-amber-gold bg-amber-gold/10 px-1.5 py-0.5 rounded-sm">{badge}</span>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="font-display text-3xl tracking-display text-deep-black leading-none">{value}</div>
        {spark && spark.length >= 2 && (
          <Sparkline values={spark} w={80} h={28} color={sparkColor ?? '#3D3D3D'} />
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-xs font-medium ${deltaCls}`}>{delta}</span>
        <span className="text-[10px] text-graphite truncate" title={deltaSub}>· {deltaSub}</span>
      </div>
    </div>
  )
}

function MiniKpi({ label, value, sub, approx, alert }: {
  label: string; value: string; sub: string; approx?: boolean; alert?: boolean
}) {
  const valCls = alert ? 'text-wine-red' : 'text-deep-black'
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-3 shadow-card">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[10px] uppercase tracking-overline text-graphite truncate">{label}</div>
        {approx && <span className="text-[9px] font-mono text-amber-gold" title="Approximate — payment-to-invoice matcher ships in Phase 2">~</span>}
      </div>
      <div className={`font-display text-xl tracking-display leading-none ${valCls}`}>{value}</div>
      <div className="text-[10px] text-graphite mt-1 truncate" title={sub}>{sub}</div>
    </div>
  )
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-4 shadow-card h-full">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div className="font-heading text-sm text-deep-black">{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}

function PhaseBadge() {
  return (
    <span
      className="inline-block text-[9px] font-mono uppercase tracking-overline text-graphite bg-cream px-1.5 py-0.5 rounded-sm cursor-help"
      title="Manual workflow field. Will become editable in Phase 2."
    >
      Phase 2
    </span>
  )
}

function LegendDot({ color, label, line, dashed }: { color: string; label: string; line?: boolean; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {line
        ? <span className="inline-block w-3 h-[2px]" style={{ backgroundColor: dashed ? 'transparent' : color, backgroundImage: dashed ? `linear-gradient(to right, ${color} 50%, transparent 50%)` : undefined, backgroundSize: dashed ? '3px 2px' : undefined }} />
        : <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
      }
      {label}
    </span>
  )
}

function BreakEvenTodayCard({ dailyBE, todayRevenue, monthlyFixed }: {
  dailyBE: number | null; todayRevenue: number; monthlyFixed: number
}) {
  if (dailyBE == null) {
    return (
      <div className="bg-warm-white border border-dashed border-pale-stone rounded-md p-3 shadow-card">
        <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">Break-even today</div>
        <div className="font-display text-xl tracking-display text-graphite leading-none">Not configured</div>
        <Link href="/m/pulse/settings" className="text-[11px] text-wine-red hover:underline mt-2 inline-block">
          {monthlyFixed === 0 ? 'Set monthly fixed costs →' : 'Fix GM% (no sales last 30d) →'}
        </Link>
      </div>
    )
  }
  const diff = todayRevenue - dailyBE
  const above = diff >= 0
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-3 shadow-card">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[10px] uppercase tracking-overline text-graphite truncate">Break-even today</div>
        <span className="text-[9px] font-mono uppercase text-amber-gold">proxy</span>
      </div>
      <div className={`font-display text-2xl tracking-display leading-none ${above ? 'text-deep-black' : 'text-wine-red'}`}>
        {fmtThbCompact(dailyBE)}
      </div>
      <div className="text-[10px] text-graphite mt-1 truncate">
        Today {fmtThbCompact(todayRevenue)} · {above ? 'above by ' : 'below by '}
        <span className={above ? 'text-deep-black' : 'text-wine-red'}>{fmtThbCompact(Math.abs(diff))}</span>
      </div>
    </div>
  )
}

function DaysAboveBECard({ dailyBE, daysAboveBE, daysPassed }: {
  dailyBE: number | null; daysAboveBE: number; daysPassed: number
}) {
  if (dailyBE == null) {
    return (
      <div className="bg-warm-white border border-dashed border-pale-stone rounded-md p-3 shadow-card">
        <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">Days above BE</div>
        <div className="font-display text-xl tracking-display text-graphite leading-none">—</div>
        <div className="text-[10px] text-graphite mt-1">Requires fixed costs</div>
      </div>
    )
  }
  const pct = daysPassed > 0 ? (daysAboveBE / daysPassed) * 100 : 0
  const tone = pct >= 70 ? 'text-deep-black' : pct >= 40 ? 'text-amber-gold' : 'text-wine-red'
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-3 shadow-card">
      <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">Days above BE · MTD</div>
      <div className={`font-display text-2xl tracking-display leading-none ${tone}`}>
        {daysAboveBE} / {daysPassed}
      </div>
      <div className="text-[10px] text-graphite mt-1">{pct.toFixed(0)}% of MTD days covered fixed costs</div>
    </div>
  )
}

function CoverageCard({ coverage, mtdCOGS, projectedCOGS, prevMonthPOTotal }: {
  coverage: number | null; mtdCOGS: number; projectedCOGS: number; prevMonthPOTotal: number
}) {
  if (coverage == null) {
    return (
      <div className="bg-warm-white border border-dashed border-pale-stone rounded-md p-3 shadow-card">
        <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">COGS coverage</div>
        <div className="font-display text-xl tracking-display text-graphite leading-none">No prev-month PO</div>
        <div className="text-[10px] text-graphite mt-1">Nothing was ordered last month (regular suppliers)</div>
      </div>
    )
  }
  const tone = coverage >= 1.0 ? 'text-deep-black' : coverage >= 0.7 ? 'text-amber-gold' : 'text-wine-red'
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-3 shadow-card" title="Projected current-month COGS ÷ previous-month PO total (regular suppliers, excludes consignment). > 1.0 = selling faster than purchasing.">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[10px] uppercase tracking-overline text-graphite truncate">COGS coverage</div>
        <span className="text-[9px] font-mono uppercase text-amber-gold">proxy</span>
      </div>
      <div className={`font-display text-2xl tracking-display leading-none ${tone}`}>
        {coverage.toFixed(2)}×
      </div>
      <div className="text-[10px] text-graphite mt-1 truncate">
        proj {fmtThbCompact(projectedCOGS)} / prev-month PO {fmtThbCompact(prevMonthPOTotal)}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SVG visualisations
// ════════════════════════════════════════════════════════════════════════════

function Sparkline({ values, w, h, color }: { values: number[]; w: number; h: number; color: string }) {
  const points = sparkPoints(values, w, h, 2)
  if (!points) return null
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={points} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ComboChart({ days, sales, gp, breakEven }: {
  days: string[]; sales: number[]; gp: number[]; breakEven?: number | null
}) {
  const w = 600, h = 160, padX = 4, padY = 10
  const innerW = w - 2 * padX
  const innerH = h - 2 * padY
  const max = Math.max(1, ...sales, ...gp, breakEven ?? 0)
  const stepX = innerW / Math.max(1, days.length)
  const barW = stepX * 0.7

  const linePoints = gp.map((v, i) => {
    const x = padX + i * stepX + stepX / 2
    const y = padY + innerH - (Math.max(0, v) / max) * innerH
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const beY = breakEven != null && breakEven > 0
    ? padY + innerH - (breakEven / max) * innerH
    : null

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
      {/* baseline */}
      <line x1={padX} y1={padY + innerH} x2={w - padX} y2={padY + innerH} stroke="#D4C9BC" strokeWidth={0.5} />
      {/* sales bars — coloured by BE comparison when BE is set */}
      {sales.map((v, i) => {
        if (v <= 0) return null
        const bh = (v / max) * innerH
        const x = padX + i * stepX + (stepX - barW) / 2
        const y = padY + innerH - bh
        const fill = breakEven == null ? '#D4C9BC' : (v >= breakEven ? '#3D3D3D' : '#8C1C1C')
        return <rect key={i} x={x} y={y} width={barW} height={bh} fill={fill} opacity={breakEven == null ? 1 : 0.85} />
      })}
      {/* break-even reference line */}
      {beY != null && (
        <line x1={padX} y1={beY} x2={w - padX} y2={beY} stroke="#C9A84C" strokeWidth={1} strokeDasharray="4 3" />
      )}
      {/* gp line */}
      <polyline points={linePoints} stroke="#8C1C1C" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Colour tokens for bucketed bars
// ════════════════════════════════════════════════════════════════════════════

const AGING_COLOR: Record<AgingBucket, string> = {
  'current': 'bg-graphite/30',
  '1-30':    'bg-amber-gold',
  '31-60':   'bg-orange-500',
  '61-90':   'bg-wine-red',
  '90+':     'bg-burgundy-deep',
}

const AP_COLOR: Record<'Overdue' | 'Today' | 'This week' | 'This month' | 'Next month' | 'Later', string> = {
  'Overdue':    'bg-burgundy-deep',
  'Today':      'bg-wine-red',
  'This week':  'bg-amber-gold',
  'This month': 'bg-graphite/50',
  'Next month': 'bg-graphite/30',
  'Later':      'bg-pale-stone',
}
