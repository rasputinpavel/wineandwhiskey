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
//   Supplier payments Σ purchase_orders where payment_date ∈ month,
//                     where payment_date = order_date + 30d (universal grace).
//                     "We pay on time" → POs with payment_date ≤ today are
//                     assumed paid; POs with payment_date > today are
//                     future obligations. Excludes consignment.
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

const AP_TERM_DAYS = 30
// 15% safety buffer on top of declared monthly fixed costs — covers small one-offs
// (repairs, surprise invoices) that aren't worth giving their own line in Settings.
const FIXED_BUFFER_RATE = 0.15

type SearchParams = { month?: string }

export default async function PulseDashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  // 13 months so the trailing 12 + current both fit, and same-month-prior-year
  // sits as the leftmost bar (year-over-year comparison at a glance).
  const months = lastNMonths(13)
  const validYms = new Set(months.map(m => m.fromDate.slice(0, 7)))
  const monthsStart = months[0].fromDate                  // 13 months ago, 1st
  const monthsStartIso = monthsStart + 'T00:00:00Z'
  const today = todayBkk()
  const { daysInMonth: currentDaysInMonth, daysPassed: currentDaysPassed } = mtdProgress()
  const currentMonth = months[months.length - 1]
  const currentYm = currentMonth.fromDate.slice(0, 7)
  // ?month=YYYY-MM jumps the Hero + Waterfall into a past month. Trend chart and
  // Cash control stay live (full 13m / today's snapshot).
  const monthParam = typeof sp.month === 'string' && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : null
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
  const poStart = isoNDaysAgo(daysBetween(today, monthsStart) + AP_TERM_DAYS)

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
        .select('id, supplier, total_thb, order_date, cashflow_override')
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

  // ─── Fetch ───────────────────────────────────────────────────────────────
  let receiptsAll: LoyverseReceipt[] = []
  let posAll: PurchaseOrder[] = []
  try {
    [receiptsAll, posAll] = await Promise.all([fetchAllReceipts(), fetchAllPOs()])
  } catch (e: any) {
    return <SchemaError error={String(e?.message ?? e)} />
  }
  const [
    fixedCostsRes,
    invoicesOpenRes,
    customersRes,
    suppliersRes,
  ] = await Promise.all([
    sbInventory
      .from('fixed_cost')
      .select('amount_thb, active'),
    sbInventory
      .from('flowaccount_invoice')
      .select('id, total, status, issued_at, due_at, customer_id')
      .neq('status', 'Cancelled')
      .eq('excluded', false),
    sbInventory
      .from('b2b_customer')
      .select('id, payment_terms_days'),
    sbInventory
      .from('supplier')
      .select('name, type'),
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

  // Supplier payments — bucketed by payment_date = order_date + 30d.
  type SupRow = Pick<Supplier, 'name' | 'type'>
  const suppliers = (suppliersRes.data ?? []) as SupRow[]
  const supByName = new Map(suppliers.map(s => [s.name.trim().toLowerCase(), s]))
  function includedInCashflow(p: Pick<PurchaseOrder, 'cashflow_override' | 'supplier'>): boolean {
    if (p.cashflow_override === 'exclude') return false
    if (p.cashflow_override === 'include') return true
    const t = p.supplier ? supByName.get(p.supplier.trim().toLowerCase())?.type : undefined
    return (t ?? 'regular') !== 'consignment'
  }
  const allPOs = posAll.filter(includedInCashflow)

  type PayPo = { total: number; paymentDate: string }
  const supplierPayments: PayPo[] = []
  for (const p of allPOs) {
    if (!p.order_date) continue
    const pd = computeDueDate(p.order_date, AP_TERM_DAYS)
    supplierPayments.push({ total: Number(p.total_thb ?? 0), paymentDate: pd })
    const ym = pd.slice(0, 7)
    const b = byMonth.get(ym)
    if (b) b.supplierPayments += Number(p.total_thb ?? 0)
  }

  // Fixed costs
  const monthlyFixedBase = ((fixedCostsRes.data ?? []) as Pick<FixedCost, 'amount_thb' | 'active'>[])
    .filter(r => r.active)
    .reduce((s, r) => s + Number(r.amount_thb), 0)
  // Effective monthly fixed used in P&L = declared total + 15% contingency.
  // Display shows base value; calculations always use the buffered amount.
  const monthlyFixed = monthlyFixedBase * (1 + FIXED_BUFFER_RATE)

  // ─── Per-month P&L ───────────────────────────────────────────────────────
  // For closed months: supplierPayments = full-month bucket; fixed = full.
  // For current month:
  //   trend cell shows MTD supplier payments (payment_date ≤ today)
  //   projection uses full-month bucket (already in byMonth)
  type MonthPnl = { ym: string; label: string; revenue: number; revenueB2C: number; revenueB2B: number; supplierPayments: number; gp: number; fixed: number; net: number; isCurrent: boolean }
  const currentYM = currentMonth.fromDate.slice(0, 7)

  const supplierPaymentsMtd = supplierPayments
    .filter(p => p.paymentDate >= startOfMonth && p.paymentDate <= today)
    .reduce((s, p) => s + p.total, 0)

  const monthsPnl: MonthPnl[] = months.map(m => {
    const ym = m.fromDate.slice(0, 7)
    const b  = byMonth.get(ym) ?? empty()
    const cur = ym === currentYm
    const fixed = cur ? monthlyFixed * (currentDaysPassed / currentDaysInMonth) : monthlyFixed
    const sup   = cur ? supplierPaymentsMtd : b.supplierPayments
    const gp    = b.total - sup
    return { ym, label: m.label, revenue: b.total, revenueB2C: b.b2c, revenueB2B: b.b2b, supplierPayments: sup, gp, fixed, net: gp - fixed, isCurrent: cur }
  })
  const selected      = monthsPnl.find(m => m.ym === selectedYm) ?? monthsPnl[monthsPnl.length - 1]
  const selectedBucket = byMonth.get(selectedYm) ?? empty()

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
  const openInvoices = ((invoicesOpenRes.data ?? []) as FlowInvoice[]).filter(i => i.status !== 'Paid')

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
  const projSupplier   = isCurrent ? currentBucket.supplierPayments : selected.supplierPayments
  const projGp         = projRevenue - projSupplier
  const projNet        = isCurrent ? (projGp - monthlyFixed) : selected.net
  // For "more by EOM" sub on waterfall — only meaningful when looking at current.
  const revenueRemainingProj  = isCurrent ? Math.max(0, projRevenue - selected.revenue) : 0
  const supplierRemainingProj = isCurrent ? Math.max(0, projSupplier - selected.supplierPayments) : 0

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

  const supplierPaymentsNext = supplierPayments
    .filter(p => p.paymentDate >= nextMonthFrom && p.paymentDate < nextMonthToExcl)
    .reduce((s, p) => s + p.total, 0)

  const expectedB2BNext = openInvoices
    .filter(inv => {
      const d = invoiceDueAt(inv)
      return d >= nextMonthFrom && d < nextMonthToExcl
    })
    .reduce((s, inv) => s + Number(inv.total), 0)

  const minRevenueNext = supplierPaymentsNext + monthlyFixed
  const minB2CNext     = Math.max(0, minRevenueNext - expectedB2BNext)

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

  // ─── Headline insight ────────────────────────────────────────────────────
  const headline = isCurrent
    ? buildHeadline({ netMtd: selected.net, netProjected: projNet, monthlyFixed })
    : buildPastHeadline({ net: selected.net, monthLabel: selected.label })

  // For trend chart scale, ignore extreme single months by using max(|net|) of 18.
  const trendMax = Math.max(1, ...monthsPnl.map(m => Math.abs(m.net)))

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

      {/* ─── Hero ────────────────────────────────────────────────────────── */}
      <HeroBlock
        net={selected.net}
        netProjected={projNet}
        isCurrent={isCurrent}
        monthLabel={selected.label}
        daysPassed={selectedDaysPassed}
        daysInMonth={selectedDaysInMonth}
        headline={headline}
      />

      {/* ─── Trend + Waterfall side by side ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <TrendCard months={monthsPnl} max={trendMax} selectedYm={selectedYm} />
        <WaterfallCard
          monthLabel={selected.label}
          isCurrent={isCurrent}
          revenue={selected.revenue}
          revenueB2C={selected.revenueB2C}
          revenueB2B={selected.revenueB2B}
          revenueRemainingProj={revenueRemainingProj}
          supplierPayments={selected.supplierPayments}
          supplierPaymentsRemaining={supplierRemainingProj}
          gp={selected.gp}
          fixedMtd={selected.fixed}
          monthlyFixedBase={monthlyFixedBase}
          net={selected.net}
          daysPassed={selectedDaysPassed}
          daysInMonth={selectedDaysInMonth}
          refGmPct={refGmPct}
        />
      </div>

      {/* ─── Next-month outlook + Cash control ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <NextMonthCard
          monthLabel={nextMonthLabel}
          supplierPaymentsNext={supplierPaymentsNext}
          monthlyFixed={monthlyFixed}
          monthlyFixedBase={monthlyFixedBase}
          expectedB2BNext={expectedB2BNext}
          minRevenueNext={minRevenueNext}
          minB2CNext={minB2CNext}
        />
        <CashControlCard arOpen={arOpen} arOverdue={arOverdue} apOpen={apOpen} workingCapital={workingCapital} />
      </div>

      {/* ─── Footer ─────────────────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between mt-2 flex-wrap gap-2 text-xs">
        <Link href="/m/pulse/operations" className="text-graphite hover:text-wine-red">
          See operational signals (break-even, AR aging, AP buckets, cash pressure) →
        </Link>
      </div>

      <details className="mt-3 bg-warm-white border border-pale-stone rounded-md text-xs">
        <summary className="cursor-pointer px-4 py-2 text-graphite hover:text-wine-red list-none flex items-center gap-1">
          <span className="text-pale-stone">▸</span> Methodology
        </summary>
        <div className="px-4 pb-4 pt-1 text-graphite space-y-2 leading-relaxed">
          <p><span className="text-deep-black">Basis</span> — cash. Revenue is recognised when money lands in Loyverse (B2C cash/card and B2B bank transfers). Unpaid FA tax invoices are AR (visible in Cash control), not revenue.</p>
          <p><span className="text-deep-black">Revenue</span> = Σ Loyverse receipts in month, SALE minus REFUND. Cancelled receipts are not yet filtered (Phase 2 — they&apos;re rare).</p>
          <p><span className="text-deep-black">Supplier payments</span> = Σ purchase orders whose payment date (order_date + 30d) falls in the month. Default 30-day grace per ops policy; supplier-specific terms ignored. Consignment suppliers excluded.</p>
          <p><span className="text-deep-black">Gross Profit</span> = Revenue − Supplier payments. Not the bookkeeping COGS — it&apos;s the cash margin after settling what&apos;s due to suppliers this month. <span className="text-deep-black">GM% (reference)</span> in the waterfall sub-line is the unit-economics margin from Loyverse cost_total — not used in Net.</p>
          <p><span className="text-deep-black">Fixed costs MTD</span> = (declared monthly fixed + 15% contingency buffer) × (days passed / days in month). The buffer covers small one-offs (repairs, surprise invoices) we don&apos;t want to manage row-by-row in Settings. Pro-rated so the in-progress month is comparable. For closed months in the 12-month trend we apply the current monthly value to all of them — no history yet.</p>
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

function HeroBlock({ net, netProjected, isCurrent, monthLabel, daysPassed, daysInMonth, headline }: {
  net: number; netProjected: number
  isCurrent: boolean; monthLabel: string
  daysPassed: number; daysInMonth: number
  headline: { tone: 'ok' | 'warn' | 'danger'; text: string }
}) {
  const positive = net >= 0
  const valCls   = positive ? 'text-deep-black' : 'text-wine-red'
  const sign     = positive ? '+' : '−'
  const projPositive = netProjected >= 0
  const projCls      = projPositive ? 'text-deep-black' : 'text-wine-red'
  const projSign     = projPositive ? '+' : '−'
  const bar = headline.tone === 'danger' ? 'bg-wine-red' : headline.tone === 'warn' ? 'bg-amber-gold' : 'bg-graphite/30'

  return (
    <div className="bg-warm-white border border-pale-stone rounded-md shadow-card mb-3 overflow-hidden">
      <div className="flex items-stretch">
        <div className={`${bar} w-1`} />
        <div className="flex-1 px-6 py-5">
          <div className="text-[10px] uppercase tracking-overline text-graphite mb-2">
            {isCurrent
              ? `Net profit · MTD · day ${daysPassed} of ${daysInMonth}`
              : `Net profit · ${monthLabel} · final`}
          </div>
          <div className={`font-display text-6xl tracking-display leading-none ${valCls}`}>
            {sign}{fmtThb(Math.abs(net)).replace(/^[-]?[฿]/, '฿')}
          </div>
          {isCurrent && (
            <div className="mt-3 flex items-baseline gap-2 flex-wrap">
              <div className="text-[10px] uppercase tracking-overline text-graphite">Projected EOM</div>
              <div className={`font-display text-xl tracking-display ${projCls}`}>
                {projSign}{fmtThb(Math.abs(netProjected)).replace(/^[-]?[฿]/, '฿')}
              </div>
            </div>
          )}
          <div className="text-sm text-deep-black mt-3">{headline.text}</div>
        </div>
      </div>
    </div>
  )
}

function buildPastHeadline({ net, monthLabel }: { net: number; monthLabel: string }): {
  tone: 'ok' | 'warn' | 'danger'; text: string
} {
  if (net > 0) return { tone: 'ok',     text: `${monthLabel} closed at +${fmtThbCompact(net)} take-home.` }
  if (net < 0) return { tone: 'danger', text: `${monthLabel} closed at a ${fmtThbCompact(Math.abs(net))} loss.` }
  return { tone: 'warn', text: `${monthLabel} closed at break-even.` }
}

function WaterfallCard({ monthLabel, isCurrent, revenue, revenueB2C, revenueB2B, revenueRemainingProj, supplierPayments, supplierPaymentsRemaining, gp, fixedMtd, monthlyFixedBase, net, daysPassed, daysInMonth, refGmPct }: {
  monthLabel: string; isCurrent: boolean
  revenue: number; revenueB2C: number; revenueB2B: number; revenueRemainingProj: number
  supplierPayments: number; supplierPaymentsRemaining: number
  gp: number; fixedMtd: number; monthlyFixedBase: number; net: number
  daysPassed: number; daysInMonth: number; refGmPct: number
}) {
  const netPositive = net >= 0
  const title = isCurrent ? 'Where the money went · MTD' : `Where the money went · ${monthLabel}`
  const revenueSub = `B2C ${fmtThbCompact(revenueB2C)} · B2B ${fmtThbCompact(revenueB2B)}${
    isCurrent && revenueRemainingProj > 0 ? ` · +${fmtThbCompact(revenueRemainingProj)} proj. by EOM` : ''
  }`
  const fixedSub = monthlyFixedBase > 0
    ? `from ${fmtThb(monthlyFixedBase)}/mo + 15% buffer`
    : 'not configured'
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-4 shadow-card h-full">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div className="font-heading text-sm text-deep-black">{title}</div>
        <Link href="/m/pulse/settings" className="text-[10px] text-graphite hover:text-wine-red">edit fixed costs →</Link>
      </div>
      <table className="w-full text-sm">
        <tbody>
          <WaterfallRow label="Revenue" value={revenue} sign="+" sub={revenueSub} />
          <WaterfallRow label="Supplier payments" value={supplierPayments} sign="−" muted
            sub={isCurrent
              ? (supplierPaymentsRemaining > 0 ? `${fmtThbCompact(supplierPaymentsRemaining)} more due by EOM` : 'all due this month covered')
              : undefined} />
          <WaterfallRow label="Gross Profit" value={gp} sign="=" bold sub={`GM% ref: ${refGmPct.toFixed(1)}%`} />
          <WaterfallRow label={isCurrent ? `Fixed (${daysPassed}/${daysInMonth} d)` : 'Fixed (full month)'} value={fixedMtd} sign="−" muted
            sub={fixedSub} />
          <WaterfallRow label="Net Profit" value={net} sign="=" bold
            valueCls={netPositive ? 'text-deep-black' : 'text-wine-red'} />
        </tbody>
      </table>
    </div>
  )
}

function WaterfallRow({ label, value, sign, sub, bold, muted, valueCls }: {
  label: string; value: number; sign: '+' | '−' | '='
  sub?: string; bold?: boolean; muted?: boolean; valueCls?: string
}) {
  const cls = valueCls ?? (muted ? 'text-graphite' : 'text-deep-black')
  return (
    <tr className={`border-b border-pale-stone/40 last:border-0 ${bold ? 'border-pale-stone' : ''}`}>
      <td className={`py-2 text-graphite ${bold ? 'text-deep-black' : ''}`}>
        <span className="inline-block w-4 text-[10px] text-graphite/60">{sign}</span>
        {label}
      </td>
      <td className={`py-2 text-right tabular-nums ${cls} ${bold ? 'font-medium' : ''}`}>
        {fmtThb(Math.abs(value))}
      </td>
      {sub
        ? <td className="py-2 text-right text-[10px] text-graphite pl-2 w-40">{sub}</td>
        : <td className="py-2 w-40" />
      }
    </tr>
  )
}

function TrendCard({ months, max, selectedYm }: { months: { ym: string; label: string; net: number; revenue: number; supplierPayments: number; fixed: number; isCurrent: boolean }[]; max: number; selectedYm: string }) {
  // SVG vertical bar chart with zero baseline in the middle. Each bar is a
  // <Link> to filter the Hero/Waterfall into that month.
  // Wider per-bar slot since chart now occupies half-width on desktop.
  const w = 720, h = 280, padX = 8, padTop = 24, padBottom = 40
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
                x={x + barW / 2} y={h - 8}
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
    </div>
  )
}

function NextMonthCard({ monthLabel, supplierPaymentsNext, monthlyFixed, monthlyFixedBase, expectedB2BNext, minRevenueNext, minB2CNext }: {
  monthLabel: string
  supplierPaymentsNext: number
  monthlyFixed: number
  monthlyFixedBase: number
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
            sub={monthlyFixedBase > 0 ? `${fmtThb(monthlyFixedBase)}/mo + 15% buffer` : 'not configured'} />
          <NMORow label="Min revenue needed" value={minRevenueNext} sign="=" bold />
          <NMORow label="Expected B2B inflow" value={expectedB2BNext} sign="+"
            sub="open FA invoices maturing next month" tone="pos" />
        </div>
      </div>
    </div>
  )
}

function NMORow({ label, value, sign, sub, bold, tone }: {
  label: string; value: number; sign: '+' | '−' | '='
  sub?: string; bold?: boolean; tone?: 'pos' | 'neg'
}) {
  const valueCls = bold ? 'text-deep-black font-medium' : tone === 'pos' ? 'text-deep-black' : 'text-graphite'
  return (
    <div className={`flex items-baseline gap-2 ${bold ? 'pt-1.5 border-t border-pale-stone/60' : ''}`}>
      <span className="w-3 text-[10px] text-graphite/60 shrink-0">{sign}</span>
      <div className="flex-1 min-w-0">
        <div className={bold ? 'text-deep-black' : 'text-graphite'}>{label}</div>
        {sub && <div className="text-[10px] text-graphite/80 mt-0.5">{sub}</div>}
      </div>
      <div className={`tabular-nums text-right ${valueCls}`}>{fmtThb(value)}</div>
    </div>
  )
}

function CashControlCard({ arOpen, arOverdue, apOpen, workingCapital }: {
  arOpen: number; arOverdue: number; apOpen: number; workingCapital: number
}) {
  const wcPositive = workingCapital >= 0
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-4 shadow-card">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div className="font-heading text-sm text-deep-black">Cash control · working capital snapshot</div>
        <div className="text-[10px] text-graphite">not a bank balance</div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">AR Open · they owe us</div>
          <div className="font-display text-2xl tracking-display text-deep-black leading-none">+{fmtThbCompact(arOpen)}</div>
          {arOverdue > 0 && (
            <div className="text-[10px] text-wine-red mt-1">{fmtThbCompact(arOverdue)} overdue</div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">AP Open · we owe suppliers</div>
          <div className="font-display text-2xl tracking-display text-wine-red leading-none">−{fmtThbCompact(apOpen)}</div>
          <div className="text-[10px] text-graphite mt-1">future obligations only (we pay on time)</div>
        </div>
        <div className="sm:border-l sm:border-pale-stone sm:pl-4">
          <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">Net working capital</div>
          <div className={`font-display text-2xl tracking-display leading-none ${wcPositive ? 'text-deep-black' : 'text-wine-red'}`}>
            {wcPositive ? '+' : '−'}{fmtThbCompact(Math.abs(workingCapital))}
          </div>
          <div className="text-[10px] text-graphite mt-1">if all debts settle now</div>
        </div>
      </div>
    </div>
  )
}
