import Link from 'next/link'
import { sbInventory, type FixedCost } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { fmtThb, fmtThbCompact, todayBkk } from '@/lib/kpi'
import {
  type DashReceipt, fixedModel, monthlyTotals, monthlyBreakdown, monthlySeries, buildAnnualPlan,
  buildPeriodTable, currentMonthHeadline, cumulativeProgress, factPlanSeries,
  type PeriodRow, type HeadlineMetric, type AnnualPlan,
} from '@/lib/dashboard'
import { RetailB2BChart, GpFixedChart, ProgressChart, FactPlanChart } from '@/components/modules/dashboard/MonthlyCharts'
import { getReceiptHistory } from '@/lib/receipts-cache'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const today = todayBkk()

  // Full history (cached, shared across the analytics pages) — the dashboard's
  // '2025-01-01' base is the cache's superset start, so no slice needed here.
  let receipts: DashReceipt[] = []
  let fixedRows: FixedCost[] = []
  try {
    const [r, fc] = await Promise.all([
      getReceiptHistory(),
      sbInventory.from('fixed_cost').select('*'),
    ])
    receipts = r
    if (fc.error) throw fc.error
    fixedRows = (fc.data ?? []) as FixedCost[]
  } catch (e: unknown) {
    return <SchemaError error={String((e as { message?: string })?.message ?? e)} />
  }

  const fx = fixedModel(fixedRows)
  const monthly = monthlyTotals(receipts)
  const annual = buildAnnualPlan(monthly, today)
  const periods = buildPeriodTable(receipts, fx, today)
  const headline = currentMonthHeadline(receipts, today)
  const endYm = `${today.slice(0, 4)}-12`
  const chartMonths = monthlySeries(monthlyBreakdown(receipts), fx, '2025-03', endYm)
  const progress = cumulativeProgress(receipts, today)
  const factPlan = factPlanSeries(monthly, '2025-03', endYm)

  return (
    <div className="space-y-6">
      <AnnualHero annual={annual} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <HeadlineCard title="Revenue" sub={`${headline.label} · vs last year ×1.25`} m={headline.revenue} />
        <HeadlineCard title="Gross profit" sub={`${headline.label} · unit margin`} m={headline.gp} />
      </div>

      <PeriodTable rows={periods} />

      <RetailB2BChart data={chartMonths} />
      <GpFixedChart data={chartMonths} />

      <ProgressChart d={progress} />
      <FactPlanChart data={factPlan} />

      <Footnote />
    </div>
  )
}

// ─── Annual plan hero ────────────────────────────────────────────────────────

function AnnualHero({ annual }: { annual: AnnualPlan }) {
  const pct = Math.max(0, Math.min(1, annual.pctOfPlan))
  return (
    <section className="bg-warm-white border border-pale-stone rounded-sm p-5">
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-3 mb-3">
        <h2 className="font-heading text-lg text-deep-black shrink-0">Annual plan {annual.year}</h2>
        <span className="text-xs text-graphite sm:text-right">Plan = last year × 1.25 (from Apr); earlier months locked at actual</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Fact YTD" value={fmtThbCompact(annual.factYtd)} accent />
        <Stat label="Goal" value={fmtThbCompact(annual.goal)} />
        <Stat label="% of plan" value={`${(annual.pctOfPlan * 100).toFixed(1)}%`} />
        <Stat label="Remaining" value={fmtThbCompact(annual.remaining)} />
      </div>
      <div className="mt-4 h-2.5 bg-cream rounded-full overflow-hidden">
        <div className="h-full bg-wine-red rounded-full" style={{ width: `${(pct * 100).toFixed(1)}%` }} />
      </div>
    </section>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="overline text-graphite mb-1">{label}</div>
      <div className={`font-display text-2xl leading-none ${accent ? 'text-wine-red' : 'text-deep-black'}`}>{value}</div>
    </div>
  )
}

// ─── Headline cards (revenue / GP) ───────────────────────────────────────────

function HeadlineCard({ title, sub, m }: { title: string; sub: string; m: HeadlineMetric }) {
  const pct = m.pctOfPlan
  const tone = pct >= 1 ? 'text-deep-black' : pct >= 0.8 ? 'text-amber-gold' : 'text-wine-red'
  return (
    <section className="bg-warm-white border border-pale-stone rounded-sm p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-heading text-base text-deep-black">{title}</h3>
        <span className="text-[11px] text-graphite">{sub}</span>
      </div>
      <div className="font-display text-3xl text-deep-black leading-none mt-2">{fmtThb(m.actual)}</div>
      <div className="flex items-center gap-4 mt-3 text-xs text-graphite">
        <span>LY <span className="text-deep-black">{fmtThbCompact(m.lastYear)}</span></span>
        <span>Plan <span className="text-deep-black">{fmtThbCompact(m.plan)}</span></span>
        <span className={`ml-auto font-medium ${tone}`}>{(pct * 100).toFixed(1)}% of plan</span>
      </div>
    </section>
  )
}

// ─── Period table ────────────────────────────────────────────────────────────

function PeriodTable({ rows }: { rows: PeriodRow[] }) {
  return (
    <section className="bg-warm-white border border-pale-stone rounded-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-pale-stone">
        <h3 className="font-heading text-base text-deep-black">By period</h3>
      </div>

      {/* Mobile: stacked cards (the 10-col table is unusable at 375px) */}
      <div className="md:hidden divide-y divide-pale-stone/60">
        {rows.map(r => (
          <div key={r.key} className="px-4 py-3">
            <div className="flex items-baseline justify-between mb-2 gap-3">
              <span className="font-medium text-deep-black">{r.label}</span>
              <span className="font-display text-lg text-deep-black tabular-nums">{fmtThb(r.total)}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <CardRow k="Retail" v={fmtThb(r.retail)} />
              <CardRow k="B2B" v={fmtThb(r.b2b)} />
              <CardRow k="Receipts" v={r.checks.toLocaleString('en-US')} />
              <CardRow k="Avg check" v={fmtThb(r.avgCheck)} />
              <CardRow k="GP" v={`${fmtThb(r.gp)} · ${(r.gpPct * 100).toFixed(1)}%`} />
              <CardRow k="Fixed" v={fmtThb(r.fixed)} />
              <CardRow k="Profit" v={fmtThb(r.profit)} accent={r.profit < 0} />
            </dl>
          </div>
        ))}
      </div>

      {/* Desktop: full table, unchanged */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-graphite border-b border-pale-stone">
              <Th className="text-left">Period</Th>
              <Th>Retail</Th><Th>B2B</Th><Th>Total</Th><Th>Receipts</Th>
              <Th>GP</Th><Th>GP%</Th><Th>Fixed</Th><Th>Profit</Th><Th>Avg check</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-pale-stone/60 last:border-0 hover:bg-cream/40">
                <td className="px-3 py-2.5 text-left text-deep-black whitespace-nowrap">{r.label}</td>
                <Td>{fmtThb(r.retail)}</Td>
                <Td>{fmtThb(r.b2b)}</Td>
                <Td bold>{fmtThb(r.total)}</Td>
                <Td>{r.checks.toLocaleString('en-US')}</Td>
                <Td>{fmtThb(r.gp)}</Td>
                <Td>{(r.gpPct * 100).toFixed(1)}%</Td>
                <Td>{fmtThb(r.fixed)}</Td>
                <Td bold className={r.profit < 0 ? 'text-wine-red' : 'text-deep-black'}>{fmtThb(r.profit)}</Td>
                <Td>{fmtThb(r.avgCheck)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 font-normal overline text-right ${className}`}>{children}</th>
}
function Td({ children, bold, className = '' }: { children: React.ReactNode; bold?: boolean; className?: string }) {
  return <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${bold ? 'font-medium text-deep-black' : 'text-graphite'} ${className}`}>{children}</td>
}
function CardRow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-graphite">{k}</dt>
      <dd className={`tabular-nums ${accent ? 'text-wine-red font-medium' : 'text-deep-black'}`}>{v}</dd>
    </div>
  )
}

// ─── Footnote ────────────────────────────────────────────────────────────────

function Footnote() {
  return (
    <div className="text-[11px] text-graphite leading-relaxed border-t border-pale-stone pt-4 space-y-1">
      <p><span className="text-deep-black">Revenue</span> = Σ Loyverse receipts (SALE − REFUND), cancelled purged. <span className="text-deep-black">GP</span> = revenue − Loyverse cost (unit-economics margin), not the cash margin Pulse shows.</p>
      <p><span className="text-deep-black">Fixed</span> = fixed costs (Pulse Settings, no run-rate buffer) + 1% premium fund of revenue, pro-rated by days. <span className="text-deep-black">Plan</span> = last year × 1.25 from Apr 2026; Jan–Mar locked at actual.</p>
      <p>For run-rate, projection and AR/AP cash control see <Link href="/m/pulse" className="text-wine-red hover:underline">Finance Pulse</Link>. Manual ledgers still live in the <Link href="/m/dashboard-sheet" className="text-wine-red hover:underline">Google Sheet</Link> during migration.</p>
    </div>
  )
}
