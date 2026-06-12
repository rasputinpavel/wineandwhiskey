import Link from 'next/link'
import { sbInventory, type FixedCost, type MandatoryActual } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import {
  CategoryCell, AmountCell, DueDayCell, ActiveCell, DeleteCell, NewCostRow,
} from '@/components/modules/pulse/FixedCostCells'
import { StatusCell } from '@/components/modules/fixed/ObligationCells'
import { fmtThb, todayBkk } from '@/lib/kpi'
import { generateObligations, applyOverrides, sumBucket } from '@/lib/mandatory'
import { fetchExpenses, type WalletExpense } from '@/lib/income'
import { type DashReceipt, monthlyTotals, MONTH_ABBR } from '@/lib/dashboard'

export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }

const MONTH_RE = /^\d{4}-\d{2}$/
function addMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTH_ABBR[m - 1]} ${y}`
}

export default async function FixedCostsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const monthParam = typeof sp.month === 'string' && MONTH_RE.test(sp.month) ? sp.month : null
  const view: 'template' | 'month' = monthParam ? 'month' : 'template'

  const costsRes = await sbInventory
    .from('fixed_cost')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('category', { ascending: true })
  if (costsRes.error) return <SchemaError error={costsRes.error.message} />
  const rows = (costsRes.data ?? []) as FixedCost[]

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="font-heading text-xl text-deep-black mb-1">Fixed Costs</h2>
          <p className="text-graphite text-sm max-w-3xl">
            Recurring obligations you&apos;d pay even if the shop was closed (rent, salary, taxes, utilities).
            Give each a due-day so Rolling and the Payment Calendar place it on its real date, and track plan vs actual per month.
          </p>
        </div>
        <ViewTabs view={view} month={monthParam ?? todayBkk().slice(0, 7)} />
      </div>

      {view === 'template'
        ? <TemplateView rows={rows} />
        : <MonthView rows={rows} month={monthParam!} />}
    </>
  )
}

function ViewTabs({ view, month }: { view: 'template' | 'month'; month: string }) {
  const base = 'text-xs px-3 py-1.5 rounded-sm border transition-colors'
  return (
    <div className="inline-flex gap-1">
      <Link href="/m/fixed-costs" className={`${base} ${view === 'template' ? 'bg-wine-red text-warm-white border-wine-red' : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red'}`}>Template</Link>
      <Link href={`/m/fixed-costs?month=${month}`} className={`${base} ${view === 'month' ? 'bg-wine-red text-warm-white border-wine-red' : 'bg-warm-white text-graphite border-pale-stone hover:border-wine-red'}`}>Month</Link>
    </div>
  )
}

// ─── Template view — the monthly template (moved out of Pulse settings) ───────

function TemplateView({ rows }: { rows: FixedCost[] }) {
  const activeRows  = rows.filter(r => r.active)
  const fixedRows   = activeRows.filter(r => r.percent_revenue == null)
  const pctRows     = activeRows.filter(r => r.percent_revenue != null)
  const fixedSum    = fixedRows.reduce((s, r) => s + Number(r.amount_thb ?? 0), 0)
  const pctSum      = pctRows.reduce((s, r) => s + Number(r.percent_revenue ?? 0), 0)
  const datedCount  = activeRows.filter(r => r.due_day != null).length
  const undatedCount = activeRows.length - datedCount

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Fixed THB (active)" value={fmtThb(fixedSum)} note={`${fixedRows.length} categories`} />
        <Stat label="% of revenue (active)" value={`${pctSum.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`} note={`${pctRows.length} categories`} />
        <Stat label="Dated" value={String(datedCount)} note={`${undatedCount} not projected (no day)`} tone={undatedCount > 0 ? 'warn' : 'normal'} />
        <Stat label="Inactive rows" value={String(rows.filter(r => !r.active).length)} note="kept for history" muted />
      </div>

      {undatedCount > 0 && (
        <p className="text-[12px] text-amber-gold bg-amber-gold/10 border border-amber-gold/30 rounded-sm px-3 py-2 mb-3">
          {undatedCount} active {undatedCount === 1 ? 'cost has' : 'costs have'} no due-day — until set, they are <strong>not projected</strong> in Rolling or the Payment Calendar and won&apos;t appear in the monthly plan/fact. Set a day for every recurring obligation.
        </p>
      )}

      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="py-2 px-4 text-left font-normal">Category</th>
              <th className="py-2 px-4 text-right font-normal">Amount</th>
              <th className="py-2 px-3 text-center font-normal">Due day</th>
              <th className="py-2 px-4 text-center font-normal">Status</th>
              <th className="py-2 px-4 text-right font-normal w-12"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                <td className="py-2 px-4"><CategoryCell id={r.id} initial={r.category} /></td>
                <td className="py-2 px-4 text-right"><AmountCell id={r.id} amountThb={r.amount_thb} percentRevenue={r.percent_revenue} /></td>
                <td className="py-2 px-3 text-center"><DueDayCell id={r.id} initial={r.due_day} /></td>
                <td className="py-2 px-4 text-center"><ActiveCell id={r.id} initial={r.active} /></td>
                <td className="py-2 px-4 text-right"><DeleteCell id={r.id} category={r.category} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-graphite text-sm">No fixed costs yet. Add the first one below.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <NewCostRow />
    </>
  )
}

// ─── Month view — dated obligations reconciled to fact ────────────────────────

async function MonthView({ rows, month }: { rows: FixedCost[]; month: string }) {
  const today = todayBkk()

  // Overrides for this month + the Expenses sheet (fact) + receipts (for % rows).
  const ovRes = await sbInventory.from('mandatory_actual').select('*').eq('period', month)
  if (ovRes.error) return <SchemaError error={ovRes.error.message} />
  const overrides = (ovRes.data ?? []) as MandatoryActual[]

  let expenses: WalletExpense[] = []
  let expensesError: string | null = null
  try { expenses = await fetchExpenses() } catch (e: unknown) { expensesError = String((e as { message?: string })?.message ?? e) }

  // Monthly revenue for percent-of-revenue rows (actual for closed months,
  // actual-so-far for the current one). Page through Loyverse receipts.
  const receipts: DashReceipt[] = []
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await sbInventory
      .from('loyverse_receipt')
      .select('receipt_date, receipt_type, total, cost_total, is_b2b')
      .gte('receipt_date', `${month}-01`).lte('receipt_date', `${month}-31`)
      .range(from, from + 999)
    if (error) return <SchemaError error={error.message} />
    if (!data || data.length === 0) break
    receipts.push(...(data as DashReceipt[]))
    if (data.length < 1000) break
  }
  const monthly = monthlyTotals(receipts)
  const obligations = generateObligations(month, rows, m => monthly.get(m) ?? 0)
  const reconciled = applyOverrides(obligations, overrides, today).sort((a, b) => a.date.localeCompare(b.date))

  const undated = rows.filter(r => r.active && r.due_day == null)
  const plannedTotal = reconciled.reduce((s, o) => s + o.planned, 0)
  // Actual mandatory spend is the whole "Обязательные" bucket from the sheet —
  // the sheet has no per-obligation detail, so fact lives at the bucket level.
  const actualBucket = sumBucket(expenses, month, 'mandatory')
  const paidCount    = reconciled.filter(o => o.status === 'paid').length

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <Link href={`/m/fixed-costs?month=${addMonth(month, -1)}`} className="text-xs px-2 py-1 border border-pale-stone rounded-sm hover:border-wine-red text-graphite">←</Link>
        <span className="font-display text-lg tracking-display text-deep-black">{monthLabel(month)}</span>
        <Link href={`/m/fixed-costs?month=${addMonth(month, 1)}`} className="text-xs px-2 py-1 border border-pale-stone rounded-sm hover:border-wine-red text-graphite">→</Link>
      </div>

      {expensesError && (
        <p className="text-[12px] text-wine-red bg-wine-red/[0.06] border border-wine-red/30 rounded-sm px-3 py-2 mb-3">
          Expenses sheet not loaded ({expensesError}). Actual bucket total unavailable. Set GOOGLE_* env.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Plan" value={fmtThb(plannedTotal)} note={`${reconciled.length} obligations`} />
        <Stat label="Actual · Обязательные" value={fmtThb(actualBucket)} note="from Expenses sheet" />
        <Stat label="Variance" value={fmtThb(actualBucket - plannedTotal)} note="actual − plan" tone={actualBucket - plannedTotal > 0 ? 'warn' : 'normal'} />
        <Stat label="Marked paid" value={`${paidCount}/${reconciled.length}`} note={`${reconciled.length - paidCount} not marked`} muted />
      </div>

      <p className="text-[12px] text-graphite mb-3">
        <strong>Plan</strong> is your template, broken down per obligation. <strong>Actual</strong> is the
        month&apos;s whole <span className="font-mono">Обязательные</span> bucket from the Expenses sheet — it has no
        per-obligation detail, so fact is compared at the bucket level. Mark rows paid to track what&apos;s settled.
      </p>

      <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-graphite border-b border-pale-stone bg-cream/40">
            <tr>
              <th className="py-2 px-4 text-left font-normal">Due</th>
              <th className="py-2 px-4 text-left font-normal">Category</th>
              <th className="py-2 px-4 text-right font-normal">Plan</th>
              <th className="py-2 px-4 text-center font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {reconciled.map(o => (
              <tr key={o.fixedCostId} className={`border-b border-pale-stone/40 last:border-0 hover:bg-cream/40 ${o.status === 'overdue' ? 'bg-wine-red/[0.04]' : ''}`}>
                <td className="py-2 px-4 tabular-nums text-graphite">{o.date.slice(8)} {monthLabel(month).split(' ')[0]}</td>
                <td className="py-2 px-4 text-deep-black">{o.category}</td>
                <td className="py-2 px-4 text-right tabular-nums text-deep-black">{fmtThb(o.planned)}</td>
                <td className="py-2 px-4 text-center"><StatusCell fixedCostId={o.fixedCostId} period={month} status={o.status} planned={o.planned} source={o.source} /></td>
              </tr>
            ))}
            {reconciled.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-graphite text-sm">No dated obligations. Add a due-day to costs in the Template view.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {undated.length > 0 && (
        <div className="mt-4 text-[12px] text-graphite">
          <span className="text-amber-gold">No due-day set</span> — not placed on the timeline:{' '}
          {undated.map(r => r.category).join(', ')}.{' '}
          <Link href="/m/fixed-costs" className="text-wine-red hover:underline">set a day →</Link>
        </div>
      )}
    </>
  )
}

// ─── Shared stat card ─────────────────────────────────────────────────────────

function Stat({ label, value, note, muted, tone }: {
  label: string; value: string; note: string; muted?: boolean; tone?: 'normal' | 'warn'
}) {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-3 shadow-card">
      <div className="text-[10px] uppercase tracking-overline text-graphite mb-1">{label}</div>
      <div className={`font-display text-2xl tracking-display leading-none ${muted ? 'text-graphite' : tone === 'warn' ? 'text-wine-red' : 'text-deep-black'}`}>{value}</div>
      <div className="text-[10px] text-graphite mt-1">{note}</div>
    </div>
  )
}
