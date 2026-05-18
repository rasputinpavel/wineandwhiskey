import Link from 'next/link'
import { sbInventory, sbPublic, type LoyverseReceipt, type FlowInvoice, type B2bCustomer, type Supplier, type PurchaseOrder } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { DataFreshness } from '@/components/shell/DataFreshness'
import {
  periodRange, trailingDays, type Period,
  AGING_BUCKETS, AGING_LABELS, type AgingBucket, agingBucket,
  computeDueDate, daysBetween, fmtThb, fmtThbCompact, fmtPct, todayBkk, isoNDaysAgo,
} from '@/lib/kpi'

export const dynamic = 'force-dynamic'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today',      label: 'Today' },
  { key: 'wtd',        label: 'WTD' },
  { key: 'mtd',        label: 'MTD' },
  { key: 'last_month', label: 'Last month' },
]

type SearchParams = { period?: Period }

export default async function PulsePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const period: Period = (PERIODS.find(p => p.key === sp.period)?.key) ?? 'mtd'
  const range = periodRange(period)
  const trend = trailingDays(30)
  const today = todayBkk()

  // ─── Fetch all source data in parallel ──────────────────────────────────
  const [
    receiptsPeriodRes,
    receiptsTrendRes,
    invoicesOpenRes,
    invoicesPeriodRes,
    receiptsFaPeriodRes,
    customersRes,
    suppliersRes,
    posOpenRes,
  ] = await Promise.all([
    sbInventory
      .from('loyverse_receipt')
      .select('total, cost_total, is_b2b, receipt_type, receipt_date')
      .gte('receipt_date', range.fromISO)
      .lt('receipt_date', range.toISO),
    sbInventory
      .from('loyverse_receipt')
      .select('total, is_b2b, receipt_type, receipt_date')
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
      .from('flowaccount_receipt')
      .select('amount')
      .gte('paid_at', range.fromDate)
      .lt('paid_at', range.toDate),
    sbInventory
      .from('b2b_customer')
      .select('id, flowaccount_name, payment_terms_days'),
    sbInventory
      .from('supplier')
      .select('name, type, payment_terms_days'),
    // AP estimation: PO.paid_at is a manual field that's rarely filled, so we
    // can't trust it. Instead we assume supplier invoices land at order_date +
    // supplier_term (default 30d) and that we pay within ~AP_GRACE_DAYS of
    // invoice. Anything older than that is considered settled. Window of 90d
    // covers max realistic term (60d) + grace + buffer.
    sbPublic
      .from('purchase_orders')
      .select('id, po_number, supplier, total_thb, order_date, cashflow_override, url')
      .gte('order_date', isoNDaysAgo(90)),
  ])

  for (const r of [receiptsPeriodRes, receiptsTrendRes, invoicesOpenRes, invoicesPeriodRes, receiptsFaPeriodRes, customersRes, suppliersRes]) {
    if (r.error) return <div className="p-6"><SchemaError error={r.error.message} /></div>
  }
  if (posOpenRes.error) return <div className="p-6"><SchemaError error={posOpenRes.error.message} /></div>

  // ─── Sales / COGS / GP (Loyverse receipts) ──────────────────────────────
  const receipts = (receiptsPeriodRes.data ?? []) as LoyverseReceipt[]
  let netSales = 0, b2cSales = 0, b2bSales = 0, cogs = 0
  for (const r of receipts) {
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const total = Number(r.total) * sign
    const cost  = Number(r.cost_total ?? 0) * sign
    netSales += total
    cogs += cost
    if (r.is_b2b) b2bSales += total; else b2cSales += total
  }
  const grossProfit = netSales - cogs

  // ─── B2B Credit vs Cash split ───────────────────────────────────────────
  const b2bCredit = (invoicesPeriodRes.data ?? []).reduce((s: number, i: any) => s + Number(i.total), 0)
  const b2bCash = Math.max(0, b2bSales - b2bCredit)  // approximate — exact requires payment-to-invoice matcher (Phase 2)

  // ─── Collections (FlowAccount receipts) ─────────────────────────────────
  const collections = (receiptsFaPeriodRes.data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0)

  // ─── AR Open / Overdue / Aging (FA invoices, all-time open) ─────────────
  const customers = (customersRes.data ?? []) as B2bCustomer[]
  const termsByCustomer = new Map(customers.map(c => [c.id, c.payment_terms_days ?? 0]))
  const nameByCustomer  = new Map(customers.map(c => [c.id, c.flowaccount_name]))

  const openInvoices = ((invoicesOpenRes.data ?? []) as FlowInvoice[])
    .filter(i => i.status !== 'Paid')

  let arOpen = 0, arOverdue = 0
  const agingByBucket: Record<AgingBucket, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
  type OverdueRow = { id: string; number: string; customer: string; total: number; daysOverdue: number; detail_url: string | null }
  const overdueByCustomer = new Map<string, { customer: string; total: number; count: number }>()

  for (const inv of openInvoices) {
    const terms = inv.customer_id ? (termsByCustomer.get(inv.customer_id) ?? 0) : 0
    const dueAt = inv.due_at ?? (terms > 0 ? computeDueDate(inv.issued_at, terms) : inv.issued_at)
    const dpd = daysBetween(today, dueAt)
    const bucket = agingBucket(dpd)
    const total = Number(inv.total)
    arOpen += total
    agingByBucket[bucket] += total
    if (dpd > 0) {
      arOverdue += total
      const key = inv.customer_name || nameByCustomer.get(inv.customer_id ?? '') || '(unknown)'
      const cur = overdueByCustomer.get(key) ?? { customer: key, total: 0, count: 0 }
      cur.total += total
      cur.count += 1
      overdueByCustomer.set(key, cur)
    }
  }

  const topOverdue: OverdueRow[] = ((invoicesOpenRes.data ?? []) as FlowInvoice[])
    .map(inv => {
      const terms = inv.customer_id ? (termsByCustomer.get(inv.customer_id) ?? 0) : 0
      const dueAt = inv.due_at ?? (terms > 0 ? computeDueDate(inv.issued_at, terms) : inv.issued_at)
      const dpd = daysBetween(today, dueAt)
      return {
        id: inv.id, number: inv.number,
        customer: inv.customer_name || nameByCustomer.get(inv.customer_id ?? '') || '(unknown)',
        total: Number(inv.total), daysOverdue: dpd, detail_url: inv.detail_url,
      }
    })
    .filter(x => x.daysOverdue > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  const topOverdueCustomers = [...overdueByCustomer.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  // ─── Supplier AP ────────────────────────────────────────────────────────
  // payment_due = order_date + supplier.payment_terms_days (default AP_TERM_DEFAULT).
  // AP Open = sum of POs whose due date is within AP_GRACE_DAYS of today or
  // in the future. Older POs are assumed paid (we don't track paid_at reliably).
  const AP_TERM_DEFAULT = 30
  const AP_GRACE_DAYS   = 14

  type SupRow = Pick<Supplier, 'name' | 'type' | 'payment_terms_days'>
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
      const term = supFor(p.supplier)?.payment_terms_days || AP_TERM_DEFAULT
      const dueAt = computeDueDate(p.order_date!, term)
      return {
        id: p.id, po: p.po_number, supplier: p.supplier ?? '(unknown)',
        total: Number(p.total_thb ?? 0),
        dueAt,
        daysUntilDue: daysBetween(dueAt, today),  // positive = future, negative = invoice already issued
        url: p.url,
      }
    })
    .filter(d => d.daysUntilDue >= -AP_GRACE_DAYS)  // older = assumed paid

  const apOpen  = dueRows.reduce((s, d) => s + d.total, 0)
  const apDue7  = dueRows.filter(d => d.daysUntilDue <= 7).reduce((s, d) => s + d.total, 0)
  const apDue30 = dueRows.filter(d => d.daysUntilDue <= 30).reduce((s, d) => s + d.total, 0)

  const topSuppliersDue = [...dueRows]
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
    .slice(0, 5)

  // AP timeline buckets — invoice already issued (within grace) vs upcoming.
  type ApBucket = 'Invoice issued' | 'Due ≤ 7d' | 'Due 8-30d' | 'Due > 30d'
  const apBuckets: Record<ApBucket, number> = { 'Invoice issued': 0, 'Due ≤ 7d': 0, 'Due 8-30d': 0, 'Due > 30d': 0 }
  for (const d of dueRows) {
    if (d.daysUntilDue < 0)         apBuckets['Invoice issued'] += d.total
    else if (d.daysUntilDue <= 7)   apBuckets['Due ≤ 7d']       += d.total
    else if (d.daysUntilDue <= 30)  apBuckets['Due 8-30d']      += d.total
    else                             apBuckets['Due > 30d']      += d.total
  }

  // ─── Sales trend (30 days) ──────────────────────────────────────────────
  const trendByDay = new Map<string, { b2c: number; b2b: number }>()
  for (const d of trend.days) trendByDay.set(d, { b2c: 0, b2b: 0 })
  for (const r of (receiptsTrendRes.data ?? []) as LoyverseReceipt[]) {
    const day = r.receipt_date.slice(0, 10)
    const cell = trendByDay.get(day)
    if (!cell) continue
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const total = Number(r.total) * sign
    if (r.is_b2b) cell.b2b += total; else cell.b2c += total
  }
  const trendData = trend.days.map(d => ({ day: d, ...(trendByDay.get(d) ?? { b2c: 0, b2b: 0 }) }))
  const trendMax = Math.max(1, ...trendData.map(t => t.b2c + t.b2b))

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">KPI Pulse · {range.label}</h2>
        <DataFreshness sources={['loyverse_stock', 'flowaccount_invoices', 'flowaccount_receipts', 'purchase_orders']} />
      </div>
      <p className="text-graphite text-sm mb-4 max-w-3xl">
        Loyverse — source of truth for sales &amp; cost. FlowAccount — source of truth for B2B receivables.
        Numbers reconciled without double-counting cash. <span className="text-deep-black">B2B Cash Sales</span> approximate
        until payment-to-invoice matcher ships (Phase 2). <span className="text-deep-black">Supplier AP</span> estimated:
        invoice date = order date + 30d (or supplier term); POs older than invoice date + 14d assumed paid (manual
        paid_at field is unreliable).
      </p>

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

      {/* Row 1: Top-line P&L */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
        <Kpi label="Net Sales" value={fmtThbCompact(netSales)} sub={`${receipts.length} receipts`} />
        <Kpi label="COGS"      value={fmtThbCompact(cogs)} sub="cost of goods sold" />
        <Kpi label="Gross Profit" value={fmtThbCompact(grossProfit)} sub={fmtPct(grossProfit, netSales) + ' margin'} highlight />
        <Kpi label="Gross Margin %" value={fmtPct(grossProfit, netSales)} sub="GP / Net Sales" />
        <Kpi label="B2B Sales" value={fmtThbCompact(b2bSales)} sub={fmtPct(b2bSales, netSales) + ' of total'} />
        <Kpi label="Supplier AP Open" value={fmtThbCompact(apOpen)} sub={`${dueRows.length} active PO`} muted />
      </div>

      {/* Row 2: B2B / AR / AP detail */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Kpi label="B2B Cash Sales" value={fmtThbCompact(b2bCash)} sub="immediate payment" approx />
        <Kpi label="B2B Credit Sales" value={fmtThbCompact(b2bCredit)} sub="FA invoices issued" />
        <Kpi label="B2B AR Open" value={fmtThbCompact(arOpen)} sub={`${openInvoices.length} open inv.`} />
        <Kpi label="B2B AR Overdue" value={fmtThbCompact(arOverdue)} sub={fmtPct(arOverdue, arOpen) + ' of open'} alert={arOverdue > 0} />
        <Kpi label="Collections" value={fmtThbCompact(collections)} sub="FA receipts in period" />
        <Kpi label="Payments Due 7d" value={fmtThbCompact(apDue7)} sub={`30d: ${fmtThbCompact(apDue30)}`} alert={apDue7 > 0} />
      </div>

      {/* Charts row 1: Sales trend + AR Aging */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <Card title="Sales trend · last 30 days" sub="B2C (cream) + B2B (wine)">
          <div className="flex items-end gap-[2px] h-32">
            {trendData.map(t => {
              const total = t.b2c + t.b2b
              const h = (total / trendMax) * 100
              const b2cH = total > 0 ? (t.b2c / total) * h : 0
              const b2bH = total > 0 ? (t.b2b / total) * h : 0
              return (
                <div key={t.day} className="flex-1 flex flex-col justify-end" title={`${t.day}\nB2C: ${fmtThb(t.b2c)}\nB2B: ${fmtThb(t.b2b)}`}>
                  <div className="bg-wine-red" style={{ height: `${b2bH}%` }} />
                  <div className="bg-cream border-t border-pale-stone" style={{ height: `${b2cH}%` }} />
                </div>
              )
            })}
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-graphite font-mono">
            <span>{trendData[0]?.day.slice(5)}</span>
            <span>{trendData[trendData.length - 1]?.day.slice(5)}</span>
          </div>
        </Card>

        <Card title="AR Aging · all open invoices" sub={`${fmtThb(arOpen)} total`}>
          <div className="space-y-2">
            {AGING_BUCKETS.map(b => {
              const v = agingByBucket[b]
              const pct = arOpen > 0 ? (v / arOpen) * 100 : 0
              const isOverdue = b !== 'current'
              return (
                <div key={b} className="flex items-center gap-3 text-xs">
                  <div className="w-16 text-graphite">{AGING_LABELS[b]}</div>
                  <div className="flex-1 bg-cream rounded-sm h-5 overflow-hidden">
                    <div
                      className={isOverdue ? 'bg-wine-red h-full' : 'bg-graphite/40 h-full'}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="w-24 text-right tabular-nums text-deep-black">{fmtThb(v)}</div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* Charts row 2: AP timeline + Top tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
        <Card title="AP due timeline" sub={`${fmtThb(apOpen)} total open`}>
          <div className="space-y-2">
            {(Object.keys(apBuckets) as (keyof typeof apBuckets)[]).map(b => {
              const v = apBuckets[b]
              const pct = apOpen > 0 ? (v / apOpen) * 100 : 0
              const danger = b === 'Overdue' || b === 'Due ≤ 7d'
              return (
                <div key={b} className="flex items-center gap-3 text-xs">
                  <div className="w-20 text-graphite">{b}</div>
                  <div className="flex-1 bg-cream rounded-sm h-5 overflow-hidden">
                    <div
                      className={danger ? 'bg-wine-red h-full' : 'bg-graphite/40 h-full'}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="w-24 text-right tabular-nums text-deep-black">{fmtThb(v)}</div>
                </div>
              )
            })}
          </div>
        </Card>

        <Card title="Top overdue B2B" sub="aggregated by customer">
          {topOverdueCustomers.length === 0
            ? <div className="text-xs text-graphite py-4 text-center">Nothing overdue 🎉</div>
            : <table className="w-full text-xs">
                <tbody>
                  {topOverdueCustomers.map(c => (
                    <tr key={c.customer} className="border-b border-pale-stone/40 last:border-0">
                      <td className="py-1.5 truncate max-w-[12rem]" title={c.customer}>{c.customer}</td>
                      <td className="py-1.5 text-right tabular-nums text-graphite">{c.count}</td>
                      <td className="py-1.5 text-right tabular-nums text-deep-black">{fmtThb(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
        </Card>

        <Card title="Top suppliers due soon" sub="next 5 by due date">
          {topSuppliersDue.length === 0
            ? <div className="text-xs text-graphite py-4 text-center">No upcoming AP</div>
            : <table className="w-full text-xs">
                <tbody>
                  {topSuppliersDue.map(d => (
                    <tr key={d.id} className="border-b border-pale-stone/40 last:border-0">
                      <td className="py-1.5">
                        {d.url
                          ? <a href={d.url} target="_blank" rel="noreferrer" className="hover:text-wine-red truncate block max-w-[10rem]" title={d.supplier}>{d.supplier}</a>
                          : <span className="truncate block max-w-[10rem]" title={d.supplier}>{d.supplier}</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-graphite text-[11px]">
                        {d.daysUntilDue < 0 ? `${-d.daysUntilDue}d late` : `${d.daysUntilDue}d`}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-deep-black">{fmtThb(d.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
        </Card>
      </div>

      {/* Top overdue invoices detail */}
      {topOverdue.length > 0 && (
        <Card title="Top overdue invoices" sub="by amount">
          <table className="w-full text-xs">
            <thead className="text-graphite border-b border-pale-stone">
              <tr>
                <th className="py-1.5 text-left">Invoice</th>
                <th className="py-1.5 text-left">Customer</th>
                <th className="py-1.5 text-right">Days late</th>
                <th className="py-1.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {topOverdue.map(o => (
                <tr key={o.id} className="border-b border-pale-stone/40 last:border-0">
                  <td className="py-1.5">
                    {o.detail_url
                      ? <a href={o.detail_url} target="_blank" rel="noreferrer" className="hover:text-wine-red font-mono">{o.number}</a>
                      : <span className="font-mono">{o.number}</span>}
                  </td>
                  <td className="py-1.5 truncate max-w-[14rem]" title={o.customer}>{o.customer}</td>
                  <td className="py-1.5 text-right tabular-nums text-wine-red">{o.daysOverdue}d</td>
                  <td className="py-1.5 text-right tabular-nums text-deep-black">{fmtThb(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Reconciliation placeholder — Phase 2 */}
      <div className="mt-3 bg-warm-white border border-dashed border-pale-stone rounded-md p-4">
        <div className="flex items-baseline justify-between mb-1">
          <div className="font-heading text-sm text-deep-black">Reconciliation exceptions</div>
          <span className="text-[10px] font-mono text-graphite uppercase tracking-overline">Phase 2</span>
        </div>
        <p className="text-xs text-graphite leading-relaxed">
          Payment-to-invoice matcher not yet shipped. When live, this block will surface:
          B2B receipts without a matching invoice, FA receipts without a matching Loyverse payment,
          and split/over-allocated payments. Until then, B2B Cash Sales above is approximate
          (B2B Sales − B2B Credit Sales, clamped to ≥ 0).
        </p>
      </div>
    </>
  )
}

// ─── Small UI atoms ───────────────────────────────────────────────────────

function Kpi({ label, value, sub, highlight, muted, alert, approx }: {
  label: string; value: string; sub?: string
  highlight?: boolean; muted?: boolean; alert?: boolean; approx?: boolean
}) {
  const bg     = highlight ? 'bg-cream' : 'bg-warm-white'
  const border = alert ? 'border-wine-red/40' : 'border-pale-stone'
  const valCls = alert ? 'text-wine-red' : muted ? 'text-graphite' : 'text-deep-black'
  return (
    <div className={`${bg} border ${border} rounded-md p-3 shadow-card`}>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[10px] uppercase tracking-overline text-graphite truncate">{label}</div>
        {approx && <span className="text-[9px] font-mono text-amber-gold">~</span>}
      </div>
      <div className={`font-display text-2xl tracking-display leading-none ${valCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-graphite mt-1 truncate" title={sub}>{sub}</div>}
    </div>
  )
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-4 shadow-card">
      <div className="flex items-baseline justify-between mb-3">
        <div className="font-heading text-sm text-deep-black">{title}</div>
        {sub && <div className="text-[10px] text-graphite">{sub}</div>}
      </div>
      {children}
    </div>
  )
}
