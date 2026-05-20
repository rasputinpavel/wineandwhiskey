import Link from 'next/link'
import { sbInventory, type LoyverseReceipt, type FlowInvoice, type B2bCustomer, type Supplier, type PurchaseOrder, type FixedCost, sbPublic } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { DataFreshness } from '@/components/shell/DataFreshness'
import {
  lastNMonths, mtdProgress, computeDueDate, isoNDaysAgo,
  fmtThb, fmtThbCompact, todayBkk,
} from '@/lib/kpi'

export const dynamic = 'force-dynamic'

// ════════════════════════════════════════════════════════════════════════════
// Owner's monthly P&L — the single screen that answers
// "did the business make money this month, or do I need to top it up?"
//
//   Net Profit = Revenue − COGS − Fixed costs (pro-rata MTD)
//
// Everything else (operational metrics, AR aging, AP buckets, cash pressure)
// lives one tab over under /m/pulse/operations.
// ════════════════════════════════════════════════════════════════════════════

export default async function PulseDashboardPage() {
  const months = lastNMonths(6)
  const sixMonthsStart = months[0].fromDate
  const { daysInMonth, daysPassed } = mtdProgress()
  const today = todayBkk()

  // ─── Fetch ───────────────────────────────────────────────────────────────
  const [
    receiptsRes,
    fixedCostsRes,
    invoicesOpenRes,
    customersRes,
    suppliersRes,
    posOpenRes,
  ] = await Promise.all([
    sbInventory
      .from('loyverse_receipt')
      .select('total, cost_total, receipt_type, receipt_date')
      .gte('receipt_date', sixMonthsStart + 'T00:00:00Z'),
    sbInventory
      .from('fixed_cost')
      .select('amount_thb, active'),
    sbInventory
      .from('flowaccount_invoice')
      .select('total, status, issued_at, due_at, customer_id')
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
      .gte('order_date', isoNDaysAgo(90)),
  ])

  for (const r of [receiptsRes, invoicesOpenRes, customersRes, suppliersRes]) {
    if (r.error) return <SchemaError error={r.error.message} />
  }
  if (posOpenRes.error) return <SchemaError error={posOpenRes.error.message} />

  // ─── Aggregate by month ──────────────────────────────────────────────────
  type Bucket = { revenue: number; cogs: number }
  const byMonth = new Map<string, Bucket>()
  for (const m of months) byMonth.set(m.fromDate.slice(0, 7), { revenue: 0, cogs: 0 })
  for (const r of (receiptsRes.data ?? []) as LoyverseReceipt[]) {
    const ym = r.receipt_date.slice(0, 7)
    const b  = byMonth.get(ym); if (!b) continue
    const sign  = r.receipt_type === 'REFUND' ? -1 : 1
    b.revenue  += Number(r.total)             * sign
    b.cogs     += Number(r.cost_total ?? 0)   * sign
  }

  const monthlyFixed = ((fixedCostsRes.data ?? []) as Pick<FixedCost, 'amount_thb' | 'active'>[])
    .filter(r => r.active)
    .reduce((s, r) => s + Number(r.amount_thb), 0)

  // ─── Per-month P&L ───────────────────────────────────────────────────────
  // Fixed cost: current snapshot applied to each month (Phase 1 — no history).
  // Current (in-progress) month: pro-rata MTD share of fixed.
  type MonthPnl = { ym: string; label: string; revenue: number; cogs: number; gp: number; fixed: number; net: number; isCurrent: boolean }
  const monthsPnl: MonthPnl[] = months.map((m, i) => {
    const ym = m.fromDate.slice(0, 7)
    const b  = byMonth.get(ym) ?? { revenue: 0, cogs: 0 }
    const isCurrent = i === months.length - 1
    const fixed = isCurrent ? monthlyFixed * (daysPassed / daysInMonth) : monthlyFixed
    return {
      ym, label: m.label,
      revenue: b.revenue,
      cogs:    b.cogs,
      gp:      b.revenue - b.cogs,
      fixed,
      net:     b.revenue - b.cogs - fixed,
      isCurrent,
    }
  })
  const current = monthsPnl[monthsPnl.length - 1]
  const grossMarginPct = current.revenue > 0 ? (current.gp / current.revenue) * 100 : 0

  // ─── Projection to end of current month ──────────────────────────────────
  // Scale revenue + cogs by full-month/MTD ratio. Apply full monthlyFixed.
  const scale = daysPassed > 0 ? daysInMonth / daysPassed : 1
  const projectedRevenue = current.revenue * scale
  const projectedCogs    = current.cogs    * scale
  const projectedGp      = projectedRevenue - projectedCogs
  const projectedNet     = projectedGp - monthlyFixed

  // ─── Cash control: AR Open vs AP Open ────────────────────────────────────
  const customers = (customersRes.data ?? []) as Pick<B2bCustomer, 'id' | 'payment_terms_days'>[]
  const termsByCustomer = new Map(customers.map(c => [c.id, c.payment_terms_days ?? 0]))
  const openInvoices = ((invoicesOpenRes.data ?? []) as FlowInvoice[]).filter(i => i.status !== 'Paid')
  const arOpen = openInvoices.reduce((s, i) => s + Number(i.total), 0)
  let arOverdue = 0
  for (const inv of openInvoices) {
    const terms = inv.customer_id ? (termsByCustomer.get(inv.customer_id) ?? 0) : 0
    const dueAt = inv.due_at ?? (terms > 0 ? computeDueDate(inv.issued_at, terms) : inv.issued_at)
    if (dueAt < today) arOverdue += Number(inv.total)
  }

  type SupRow = Pick<Supplier, 'name' | 'type'>
  const suppliers = (suppliersRes.data ?? []) as SupRow[]
  const supByName = new Map(suppliers.map(s => [s.name.trim().toLowerCase(), s]))
  function includedInCashflow(p: Pick<PurchaseOrder, 'cashflow_override' | 'supplier'>): boolean {
    if (p.cashflow_override === 'exclude') return false
    if (p.cashflow_override === 'include') return true
    const t = p.supplier ? supByName.get(p.supplier.trim().toLowerCase())?.type : undefined
    return (t ?? 'regular') !== 'consignment'
  }
  const apOpen = ((posOpenRes.data ?? []) as PurchaseOrder[])
    .filter(includedInCashflow)
    .filter(p => {
      if (!p.order_date) return false
      const dueAt = computeDueDate(p.order_date, 30)
      return dueAt >= today.slice(0, 8) + '01'   // dueAt ≥ start of current month → still active
    })
    .reduce((s, p) => s + Number(p.total_thb ?? 0), 0)
  const workingCapital = arOpen - apOpen

  // ─── Headline insight ────────────────────────────────────────────────────
  const headline = buildHeadline({
    netMtd: current.net,
    netProjected: projectedNet,
    monthlyFixed,
  })

  const trendMax = Math.max(1, ...monthsPnl.map(m => Math.max(m.net, 0)), ...monthsPnl.map(m => Math.abs(Math.min(m.net, 0))))

  return (
    <>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">This month&apos;s bottom line</h2>
        <DataFreshness sources={['loyverse_stock', 'flowaccount_invoices', 'flowaccount_receipts', 'purchase_orders']} />
      </div>

      {/* ─── Hero: Net Profit MTD + projection ──────────────────────────── */}
      <HeroBlock
        netMtd={current.net}
        netProjected={projectedNet}
        daysPassed={daysPassed}
        daysInMonth={daysInMonth}
        headline={headline}
      />

      {/* ─── Waterfall + 6-month trend ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <WaterfallCard
          revenue={current.revenue}
          cogs={current.cogs}
          gp={current.gp}
          grossMarginPct={grossMarginPct}
          fixedMtd={current.fixed}
          monthlyFixed={monthlyFixed}
          net={current.net}
          daysPassed={daysPassed}
          daysInMonth={daysInMonth}
        />

        <TrendCard months={monthsPnl} max={trendMax} />
      </div>

      {/* ─── Cash control row ──────────────────────────────────────────── */}
      <CashControlCard arOpen={arOpen} arOverdue={arOverdue} apOpen={apOpen} workingCapital={workingCapital} />

      {/* ─── Footer: link to Operations + Methodology ──────────────────── */}
      <div className="flex items-baseline justify-between mt-4 flex-wrap gap-2 text-xs">
        <Link href="/m/pulse/operations" className="text-graphite hover:text-wine-red">
          See operational signals (break-even, AR aging, AP buckets, cash pressure) →
        </Link>
      </div>

      <details className="mt-3 bg-warm-white border border-pale-stone rounded-md text-xs">
        <summary className="cursor-pointer px-4 py-2 text-graphite hover:text-wine-red list-none flex items-center gap-1">
          <span className="text-pale-stone">▸</span> Methodology
        </summary>
        <div className="px-4 pb-4 pt-1 text-graphite space-y-2 leading-relaxed">
          <p><span className="text-deep-black">Net Profit</span> = Revenue − COGS − Fixed costs. Accrual basis: revenue and cost recognised when the sale happens, regardless of when cash moves.</p>
          <p><span className="text-deep-black">MTD fixed costs</span> = monthly_fixed × (days passed ÷ days in month). Pro-rated so the in-progress month is comparable to closed months.</p>
          <p><span className="text-deep-black">Projection</span> = revenue and COGS scaled to full month at current pace, minus full month of fixed. Assumes pace continues without seasonality.</p>
          <p><span className="text-deep-black">6-month trend</span> uses current monthly_fixed value for all months — no fixed-cost history yet. Edit fixed costs on the Settings tab.</p>
          <p><span className="text-deep-black">Cash control</span> is a working-capital snapshot: open AR (B2B owe us) − open AP (we owe suppliers). Not a true bank balance — bank integration is out of scope for Phase 1.</p>
          <p><span className="text-deep-black">Owner salary</span> is not included in fixed costs by current policy — Net Profit is the full take-home before tax.</p>
        </div>
      </details>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Headline logic
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
    return { tone: 'warn', text: `Profitable MTD, but month-end projection is negative (${fmtThbCompact(p.netProjected)}) — fixed costs eat the gains.` }
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

function WaterfallCard({ revenue, cogs, gp, grossMarginPct, fixedMtd, monthlyFixed, net, daysPassed, daysInMonth }: {
  revenue: number; cogs: number; gp: number; grossMarginPct: number
  fixedMtd: number; monthlyFixed: number; net: number
  daysPassed: number; daysInMonth: number
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
          <WaterfallRow label="Revenue"  value={revenue}            sign="+" />
          <WaterfallRow label="COGS"     value={cogs}               sign="−" muted />
          <WaterfallRow label="Gross Profit" value={gp}             sign="="  bold sub={`${grossMarginPct.toFixed(1)}% margin`} />
          <WaterfallRow label={`Fixed (${daysPassed}/${daysInMonth} d)`} value={fixedMtd} sign="−" muted
            sub={monthlyFixed > 0 ? `from ${fmtThb(monthlyFixed)}/mo` : 'not configured'} />
          <WaterfallRow label="Net Profit" value={net} sign="="  bold
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
        {fmtThb(Math.abs(value)) /* keep raw, sign comes from leading column */}
      </td>
      {sub
        ? <td className="py-2 text-right text-[10px] text-graphite pl-2 w-28">{sub}</td>
        : <td className="py-2 w-28" />
      }
    </tr>
  )
}

function TrendCard({ months, max }: { months: { label: string; net: number; isCurrent: boolean }[]; max: number }) {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-4 shadow-card">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div className="font-heading text-sm text-deep-black">Last 6 months · net profit</div>
        <div className="text-[10px] text-graphite">current month projected if dashed</div>
      </div>
      <div className="space-y-2">
        {months.map(m => {
          const w   = Math.min(100, (Math.abs(m.net) / max) * 100)
          const pos = m.net >= 0
          return (
            <div key={m.label} className="flex items-center gap-2 text-xs">
              <div className="w-12 text-graphite shrink-0 font-mono text-[11px]">{m.label}</div>
              <div className="flex-1 flex items-center gap-px h-5">
                {/* negative half — right-aligned bar growing left from centre */}
                <div className="flex-1 flex justify-end">
                  {!pos && (
                    <div
                      className={`h-full ${m.isCurrent ? 'bg-wine-red/40 border border-wine-red/60 border-dashed' : 'bg-wine-red'}`}
                      style={{ width: `${w}%` }}
                    />
                  )}
                </div>
                <div className="w-px h-full bg-pale-stone" />
                {/* positive half */}
                <div className="flex-1">
                  {pos && (
                    <div
                      className={`h-full ${m.isCurrent ? 'bg-graphite/40 border border-graphite/60 border-dashed' : 'bg-graphite'}`}
                      style={{ width: `${w}%` }}
                    />
                  )}
                </div>
              </div>
              <div className={`w-20 text-right tabular-nums text-[11px] ${pos ? 'text-deep-black' : 'text-wine-red'}`}>
                {pos ? '+' : '−'}{fmtThbCompact(Math.abs(m.net))}
              </div>
            </div>
          )
        })}
      </div>
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
          <div className="text-[10px] text-graphite mt-1">payment due within 30d of order</div>
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
