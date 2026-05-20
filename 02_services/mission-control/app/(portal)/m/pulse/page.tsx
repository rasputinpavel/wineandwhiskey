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

export default async function PulseDashboardPage() {
  // 13 months so the trailing 12 + current both fit, and same-month-prior-year
  // sits as the leftmost bar (year-over-year comparison at a glance).
  const months = lastNMonths(13)
  const monthsStart = months[0].fromDate                  // 18 months ago, 1st of month
  const monthsStartIso = monthsStart + 'T00:00:00Z'
  const today = todayBkk()
  const { daysInMonth, daysPassed } = mtdProgress()
  const currentMonth = months[months.length - 1]
  const startOfMonth = currentMonth.fromDate              // 'YYYY-MM-01'
  const endOfMonthExclusive = currentMonth.toDate         // 'YYYY-MM-01' of NEXT month
  const endOfMonthInclusive = computeDueDate(endOfMonthExclusive, -1) // last day of current month

  // To capture POs whose payment date (order + 30d) falls within the trend
  // window, we need orders up to 30 days before the window starts.
  const poStart = isoNDaysAgo(daysBetween(today, monthsStart) + AP_TERM_DAYS)

  // ─── Fetch ───────────────────────────────────────────────────────────────
  const [
    receiptsRes,
    fixedCostsRes,
    invoicesOpenRes,
    customersRes,
    suppliersRes,
    posRes,
  ] = await Promise.all([
    sbInventory
      .from('loyverse_receipt')
      .select('total, cost_total, is_b2b, receipt_type, receipt_date')
      .gte('receipt_date', monthsStartIso),
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
    sbPublic
      .from('purchase_orders')
      .select('id, supplier, total_thb, order_date, cashflow_override')
      .gte('order_date', poStart),
  ])

  for (const r of [receiptsRes, invoicesOpenRes, customersRes, suppliersRes]) {
    if (r.error) return <SchemaError error={r.error.message} />
  }
  if (posRes.error) return <SchemaError error={posRes.error.message} />

  // ─── Aggregation per month ───────────────────────────────────────────────
  type Bucket = {
    b2c: number; b2b: number; total: number; refRevCost: number
    supplierPayments: number
  }
  const empty = (): Bucket => ({ b2c: 0, b2b: 0, total: 0, refRevCost: 0, supplierPayments: 0 })
  const byMonth = new Map<string, Bucket>()
  for (const m of months) byMonth.set(m.fromDate.slice(0, 7), empty())

  // Revenue (Loyverse receipts)
  for (const r of (receiptsRes.data ?? []) as LoyverseReceipt[]) {
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
  const allPOs = ((posRes.data ?? []) as PurchaseOrder[]).filter(includedInCashflow)

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
  const monthlyFixed = ((fixedCostsRes.data ?? []) as Pick<FixedCost, 'amount_thb' | 'active'>[])
    .filter(r => r.active)
    .reduce((s, r) => s + Number(r.amount_thb), 0)

  // ─── Per-month P&L ───────────────────────────────────────────────────────
  // For closed months: supplierPayments = full-month bucket; fixed = full.
  // For current month:
  //   trend cell shows MTD supplier payments (payment_date ≤ today)
  //   projection uses full-month bucket (already in byMonth)
  type MonthPnl = { ym: string; label: string; revenue: number; supplierPayments: number; gp: number; fixed: number; net: number; isCurrent: boolean }
  const currentYM = currentMonth.fromDate.slice(0, 7)

  const supplierPaymentsMtd = supplierPayments
    .filter(p => p.paymentDate >= startOfMonth && p.paymentDate <= today)
    .reduce((s, p) => s + p.total, 0)

  const monthsPnl: MonthPnl[] = months.map(m => {
    const ym = m.fromDate.slice(0, 7)
    const b  = byMonth.get(ym) ?? empty()
    const isCurrent = ym === currentYM
    const fixed = isCurrent ? monthlyFixed * (daysPassed / daysInMonth) : monthlyFixed
    const sup   = isCurrent ? supplierPaymentsMtd : b.supplierPayments
    const gp    = b.total - sup
    return { ym, label: m.label, revenue: b.total, supplierPayments: sup, gp, fixed, net: gp - fixed, isCurrent }
  })
  const current = monthsPnl[monthsPnl.length - 1]
  const currentBucket = byMonth.get(currentYM) ?? empty()

  // Reference Gross Margin % (from Loyverse cost_total) — unit-economics signal
  const refGmPct = currentBucket.total > 0
    ? ((currentBucket.total - currentBucket.refRevCost) / currentBucket.total) * 100
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

  const scale = daysPassed > 0 ? daysInMonth / daysPassed : 1
  const projB2C        = currentBucket.b2c * scale
  const projRevenue    = projB2C + currentBucket.b2b + b2bDueByEom
  const projSupplier   = currentBucket.supplierPayments              // already full-month bucket
  const projGp         = projRevenue - projSupplier
  const projNet        = projGp - monthlyFixed

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
  const headline = buildHeadline({
    netMtd: current.net, netProjected: projNet, monthlyFixed,
  })

  // For trend chart scale, ignore extreme single months by using max(|net|) of 18.
  const trendMax = Math.max(1, ...monthsPnl.map(m => Math.abs(m.net)))

  return (
    <>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">This month&apos;s bottom line</h2>
        <DataFreshness sources={['loyverse_stock', 'flowaccount_invoices', 'flowaccount_receipts', 'purchase_orders']} />
      </div>

      {/* ─── Hero ────────────────────────────────────────────────────────── */}
      <HeroBlock
        netMtd={current.net} netProjected={projNet}
        daysPassed={daysPassed} daysInMonth={daysInMonth}
        headline={headline}
      />

      {/* ─── 18-month trend (full width) ─────────────────────────────────── */}
      <div className="mb-3">
        <TrendCard months={monthsPnl} max={trendMax} />
      </div>

      {/* ─── Waterfall + Cash Control ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <WaterfallCard
          revenue={current.revenue}
          supplierPayments={current.supplierPayments}
          supplierPaymentsRemaining={currentBucket.supplierPayments - supplierPaymentsMtd}
          gp={current.gp}
          fixedMtd={current.fixed}
          monthlyFixed={monthlyFixed}
          net={current.net}
          daysPassed={daysPassed}
          daysInMonth={daysInMonth}
          refGmPct={refGmPct}
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
          <p><span className="text-deep-black">Fixed costs MTD</span> = monthly_fixed × (days passed / days in month). Pro-rated so the in-progress month is comparable. For closed months in the 18-month trend we apply the current monthly_fixed value to all of them (no history yet).</p>
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

function HeroBlock({ netMtd, netProjected, daysPassed, daysInMonth, headline }: {
  netMtd: number; netProjected: number; daysPassed: number; daysInMonth: number
  headline: { tone: 'ok' | 'warn' | 'danger'; text: string }
}) {
  const positive = netMtd >= 0
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
            Net profit · MTD · day {daysPassed} of {daysInMonth}
          </div>
          <div className={`font-display text-6xl tracking-display leading-none ${valCls}`}>
            {sign}{fmtThb(Math.abs(netMtd)).replace(/^[-]?[฿]/, '฿')}
          </div>
          <div className="mt-3 flex items-baseline gap-2 flex-wrap">
            <div className="text-[10px] uppercase tracking-overline text-graphite">Projected EOM</div>
            <div className={`font-display text-xl tracking-display ${projCls}`}>
              {projSign}{fmtThb(Math.abs(netProjected)).replace(/^[-]?[฿]/, '฿')}
            </div>
          </div>
          <div className="text-sm text-deep-black mt-3">{headline.text}</div>
        </div>
      </div>
    </div>
  )
}

function WaterfallCard({ revenue, supplierPayments, supplierPaymentsRemaining, gp, fixedMtd, monthlyFixed, net, daysPassed, daysInMonth, refGmPct }: {
  revenue: number; supplierPayments: number; supplierPaymentsRemaining: number
  gp: number; fixedMtd: number; monthlyFixed: number; net: number
  daysPassed: number; daysInMonth: number; refGmPct: number
}) {
  const netPositive = net >= 0
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-4 shadow-card">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div className="font-heading text-sm text-deep-black">Where the money went · MTD</div>
        <Link href="/m/pulse/settings" className="text-[10px] text-graphite hover:text-wine-red">edit fixed costs →</Link>
      </div>
      <table className="w-full text-sm">
        <tbody>
          <WaterfallRow label="Revenue"  value={revenue} sign="+" />
          <WaterfallRow label="Supplier payments" value={supplierPayments} sign="−" muted
            sub={supplierPaymentsRemaining > 0 ? `${fmtThbCompact(supplierPaymentsRemaining)} more due by EOM` : 'all due this month covered'} />
          <WaterfallRow label="Gross Profit" value={gp} sign="=" bold sub={`GM% ref: ${refGmPct.toFixed(1)}%`} />
          <WaterfallRow label={`Fixed (${daysPassed}/${daysInMonth} d)`} value={fixedMtd} sign="−" muted
            sub={monthlyFixed > 0 ? `from ${fmtThb(monthlyFixed)}/mo` : 'not configured'} />
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

function TrendCard({ months, max }: { months: { label: string; net: number; revenue: number; supplierPayments: number; fixed: number; isCurrent: boolean }[]; max: number }) {
  // SVG vertical bar chart: 18 bars side-by-side, zero baseline in the middle.
  const w = 720, h = 180, padX = 8, padTop = 12, padBottom = 24
  const innerW   = w - 2 * padX
  const innerH   = h - padTop - padBottom
  const zeroY    = padTop + innerH / 2
  const halfH    = innerH / 2
  const stepX    = innerW / months.length
  const barW     = Math.max(6, stepX * 0.62)

  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-4 shadow-card">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div className="font-heading text-sm text-deep-black">Last 12 months + current · net profit</div>
        <div className="text-[10px] text-graphite">current month projected · dashed</div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-44" preserveAspectRatio="none">
        {/* zero baseline */}
        <line x1={padX} y1={zeroY} x2={w - padX} y2={zeroY} stroke="#D4C9BC" strokeWidth={0.5} />

        {months.map((m, i) => {
          const x = padX + i * stepX + (stepX - barW) / 2
          const v = m.net
          const positive = v >= 0
          const bh = Math.min(halfH, (Math.abs(v) / max) * halfH)
          const y  = positive ? zeroY - bh : zeroY
          const fill = positive ? '#3D3D3D' : '#8C1C1C'
          const opacity = m.isCurrent ? 0.45 : 1
          const dash = m.isCurrent ? '3 2' : undefined
          return (
            <g key={m.label}>
              <rect
                x={x} y={y} width={barW} height={Math.max(0.5, bh)}
                fill={fill} opacity={opacity}
                stroke={m.isCurrent ? fill : 'none'} strokeWidth={m.isCurrent ? 1 : 0}
                strokeDasharray={dash}
              >
                <title>{`${m.label}\nRevenue ${fmtThbCompact(m.revenue)} · Sup ${fmtThbCompact(m.supplierPayments)} · Fixed ${fmtThbCompact(m.fixed)}\nNet ${positive ? '+' : '−'}${fmtThbCompact(Math.abs(m.net))}${m.isCurrent ? ' (projected)' : ''}`}</title>
              </rect>
              {/* Label every 2nd month + last month — 13 bars wide enough for readable cadence */}
              {(i % 2 === 0 || i === months.length - 1) && (
                <text
                  x={x + barW / 2} y={h - 8}
                  textAnchor="middle"
                  fontSize={9} fill="#3D3D3D" fontFamily="monospace"
                >
                  {m.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
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
