// ════════════════════════════════════════════════════════════════════════════
// Dashboard — native port of the Google Sheet "Status Check W&W" / Dashboard.
//
// Pure aggregation over Loyverse receipts (inventory.loyverse_receipt) + the
// portal's fixed_cost config. Pulse owns the conservative run-rate (with a
// safety buffer); this Dashboard shows the fuller, buffer-free picture:
// the annual plan, period table, monthly progression, daily revenue.
//
// Metric definitions — MATCH the sheet, so numbers reconcile:
//   revenue   Σ signed receipt.total       (SALE +, REFUND −)
//   GP        Σ signed (total − cost_total) (unit-economics margin, ~24%)
//   GP%       GP / revenue
//   checks    count of SALE receipts (refunds don't add a check)
//   fixed     Σ fixed_cost.amount_thb (active, no buffer) pro-rated by days
//             + revenue × Σ fixed_cost.percent_revenue  (1% premium fund)
//   profit    GP − fixed
//
// Plan (annual goal): per 2026 month, plan = locked actual for months before
// PLAN_START_YM, else last-year same month × PLAN_MULT. Mirrors sync_dashboard.ts.
// ════════════════════════════════════════════════════════════════════════════

import type { LoyverseReceipt, FixedCost } from './supabase'

export const PLAN_YEAR = 2026
export const PLAN_START_YM = '2026-04' // from this month on, plan = LY × mult
export const PLAN_MULT = 1.25
const DAYS_PER_MONTH_AVG = 365 / 12

export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Receipt fields the dashboard actually needs.
export type DashReceipt = Pick<LoyverseReceipt, 'receipt_date' | 'receipt_type' | 'total' | 'cost_total' | 'is_b2b'>

export type Agg = { retail: number; b2b: number; total: number; gp: number; checks: number }
const emptyAgg = (): Agg => ({ retail: 0, b2b: 0, total: 0, gp: 0, checks: 0 })

// ─── Date helpers (work on 'YYYY-MM-DD', UTC-anchored to avoid tz drift) ─────

export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function dow(ymd: string): number { return new Date(ymd + 'T00:00:00Z').getUTCDay() } // 0=Sun
export function mondayOf(ymd: string): string { return addDays(ymd, -((dow(ymd) + 6) % 7)) }
export function firstOfMonth(ymd: string): string { return ymd.slice(0, 7) + '-01' }
export function lastOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${ym}-${String(last).padStart(2, '0')}`
}
function ymdToYm(ymd: string): string { return ymd.slice(0, 7) }
function lyYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${y - 1}-${String(m).padStart(2, '0')}`
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

// Sum receipts whose calendar date falls within [fromYmd, toYmd] inclusive.
export function aggregate(receipts: DashReceipt[], fromYmd: string, toYmd: string): Agg {
  const a = emptyAgg()
  for (const r of receipts) {
    const ymd = r.receipt_date.slice(0, 10)
    if (ymd < fromYmd || ymd > toYmd) continue
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const total = Number(r.total) * sign
    const gp = (Number(r.total) - Number(r.cost_total ?? 0)) * sign
    a.total += total
    a.gp += gp
    if (r.is_b2b) a.b2b += total; else a.retail += total
    if (r.receipt_type !== 'REFUND') a.checks += 1
  }
  return a
}

// Bucket receipts into 'YYYY-MM' → revenue total (signed). Cheap monthly index.
export function monthlyTotals(receipts: DashReceipt[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of receipts) {
    const ym = ymdToYm(r.receipt_date)
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    m.set(ym, (m.get(ym) ?? 0) + Number(r.total) * sign)
  }
  return m
}

// ─── Fixed costs (portal source of truth, no buffer) ─────────────────────────

export type FixedModel = { baseMonthly: number; pctRate: number }

export function fixedModel(rows: Pick<FixedCost, 'amount_thb' | 'percent_revenue' | 'active'>[]): FixedModel {
  const active = rows.filter(r => r.active)
  const baseMonthly = active.filter(r => r.percent_revenue == null).reduce((s, r) => s + Number(r.amount_thb ?? 0), 0)
  const pctRate = active.filter(r => r.percent_revenue != null).reduce((s, r) => s + Number(r.percent_revenue ?? 0), 0) / 100
  return { baseMonthly, pctRate }
}

// Fixed obligation for a period spanning `months` calendar months and earning
// `revenue`. `months` is fractional for sub-month windows (week ≈ 7/30.4).
export function fixedFor(fx: FixedModel, months: number, revenue: number): number {
  return fx.baseMonthly * months + revenue * fx.pctRate
}

// ─── Monthly breakdown (for the Retail/B2B and GP/Fixed charts) ──────────────

export type MonthAgg = { retail: number; b2b: number; total: number; gp: number }

export function monthlyBreakdown(receipts: DashReceipt[]): Map<string, MonthAgg> {
  const m = new Map<string, MonthAgg>()
  for (const r of receipts) {
    const ym = r.receipt_date.slice(0, 7)
    const cur = m.get(ym) ?? { retail: 0, b2b: 0, total: 0, gp: 0 }
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const total = sign * Number(r.total)
    cur.total += total
    cur.gp += sign * (Number(r.total) - Number(r.cost_total ?? 0))
    if (r.is_b2b) cur.b2b += total; else cur.retail += total
    m.set(ym, cur)
  }
  return m
}

// Chart series for [startYm … endYm] inclusive, fixed = baseMonthly + pct×revenue.
export type ChartMonth = MonthAgg & { ym: string; label: string; year: string; fixed: number }

export function monthlySeries(monthly: Map<string, MonthAgg>, fx: FixedModel, startYm: string, endYm: string): ChartMonth[] {
  const out: ChartMonth[] = []
  let [y, mo] = startYm.split('-').map(Number)
  while (`${y}-${String(mo).padStart(2, '0')}` <= endYm) {
    const ym = `${y}-${String(mo).padStart(2, '0')}`
    const a = monthly.get(ym) ?? { retail: 0, b2b: 0, total: 0, gp: 0 }
    out.push({ ...a, ym, label: MONTH_ABBR[mo - 1], year: String(y).slice(2), fixed: fx.baseMonthly + a.total * fx.pctRate })
    mo++; if (mo > 12) { mo = 1; y++ }
  }
  return out
}

// ─── Period table ──────────────────────────────────────────────────────────

export type PeriodKey = 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'ytd' | 'last-year'

export type PeriodRow = {
  key: PeriodKey
  label: string
  range: { from: string; to: string }
  retail: number; b2b: number; total: number
  checks: number; gp: number; gpPct: number
  fixed: number; profit: number; avgCheck: number
}

// `today` is Bangkok 'YYYY-MM-DD'. Builds the 6 sheet rows.
export function buildPeriodTable(receipts: DashReceipt[], fx: FixedModel, today: string): PeriodRow[] {
  const thisMonStart = mondayOf(today)
  const lastMonStart = addDays(thisMonStart, -7)
  const lastMonEnd = addDays(thisMonStart, -1)
  const curMonthFirst = firstOfMonth(today)
  const prevYm = lyYmSameYear(ymdToYm(today))
  const prevMonthFirst = `${prevYm}-01`
  const prevMonthLast = lastOfMonth(prevYm)
  const yearStart = `${today.slice(0, 4)}-01-01`
  const lyYear = String(Number(today.slice(0, 4)) - 1)

  const specs: { key: PeriodKey; label: string; from: string; to: string; months: number }[] = [
    // Week/month rows carry the FULL-period fixed obligation (you owe full rent
    // regardless of the day), matching the source sheet — not elapsed-day pro-rata.
    { key: 'this-week',  label: 'This week',  from: thisMonStart,   to: today,           months: 7 / DAYS_PER_MONTH_AVG },
    { key: 'last-week',  label: 'Last week',  from: lastMonStart,   to: lastMonEnd,      months: 7 / DAYS_PER_MONTH_AVG },
    { key: 'this-month', label: 'This month', from: curMonthFirst,  to: today,           months: 1 },
    { key: 'last-month', label: 'Last month', from: prevMonthFirst, to: prevMonthLast,   months: 1 },
    { key: 'ytd',        label: 'YTD',        from: yearStart,      to: today,           months: monthsElapsed(today) },
    { key: 'last-year',  label: lyYear,       from: `${lyYear}-01-01`, to: `${lyYear}-12-31`, months: 12 },
  ]

  return specs.map(s => {
    const a = aggregate(receipts, s.from, s.to)
    const fixed = fixedFor(fx, s.months, a.total)
    return {
      key: s.key, label: s.label, range: { from: s.from, to: s.to },
      retail: a.retail, b2b: a.b2b, total: a.total, checks: a.checks,
      gp: a.gp, gpPct: a.total ? a.gp / a.total : 0,
      fixed, profit: a.gp - fixed,
      avgCheck: a.checks ? a.total / a.checks : 0,
    }
  })
}

// Previous calendar month 'YYYY-MM' for a given 'YYYY-MM'.
function lyYmSameYear(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
// Months elapsed in the current year up to and including this month (Jan..cur).
function monthsElapsed(today: string): number { return Number(today.slice(5, 7)) }

// ─── Annual plan + monthly progression ──────────────────────────────────────

export type MonthPlan = {
  ym: string; label: string; monthIdx: number
  actual: number | null   // null = future month (no data yet)
  plan: number            // locked actual (<PLAN_START) or LY × mult
  isLockedPlan: boolean    // plan === actual (past 2026 month before PLAN_START)
}

export type AnnualPlan = {
  year: number
  months: MonthPlan[]
  goal: number            // Σ plan over the year
  factYtd: number         // Σ actual to date
  remaining: number
  pctOfPlan: number
}

export function buildAnnualPlan(monthly: Map<string, number>, today: string): AnnualPlan {
  const curYm = ymdToYm(today)
  const months: MonthPlan[] = []
  let goal = 0, factYtd = 0
  for (let i = 0; i < 12; i++) {
    const ym = `${PLAN_YEAR}-${String(i + 1).padStart(2, '0')}`
    const hasActual = ym <= curYm && monthly.has(ym)
    const actual = hasActual ? (monthly.get(ym) ?? 0) : (ym <= curYm ? 0 : null)
    const lockedPlan = ym < PLAN_START_YM
    const plan = lockedPlan ? (actual ?? 0) : (monthly.get(lyYm(ym)) ?? 0) * PLAN_MULT
    if (actual != null) factYtd += actual
    goal += plan
    months.push({ ym, label: MONTH_ABBR[i], monthIdx: i, actual, plan, isLockedPlan: lockedPlan })
  }
  return { year: PLAN_YEAR, months, goal, factYtd, remaining: goal - factYtd, pctOfPlan: goal ? factYtd / goal : 0 }
}

// ─── Current-month headline (revenue + GP vs LY vs plan) ─────────────────────

export type HeadlineMetric = { actual: number; lastYear: number; plan: number; pctOfPlan: number }

export function currentMonthHeadline(receipts: DashReceipt[], today: string): { revenue: HeadlineMetric; gp: HeadlineMetric; label: string } {
  const curYm = ymdToYm(today)
  const cur = aggregate(receipts, `${curYm}-01`, today)
  const lyMonth = lyYm(curYm)
  const ly = aggregate(receipts, `${lyMonth}-01`, lastOfMonth(lyMonth))
  const revPlan = ly.total * PLAN_MULT
  const gpPlan = ly.gp * PLAN_MULT
  const [y, mo] = curYm.split('-').map(Number)
  return {
    label: `${MONTH_ABBR[mo - 1]} ${y}`,
    revenue: { actual: cur.total, lastYear: ly.total, plan: revPlan, pctOfPlan: revPlan ? cur.total / revPlan : 0 },
    gp: { actual: cur.gp, lastYear: ly.gp, plan: gpPlan, pctOfPlan: gpPlan ? cur.gp / gpPlan : 0 },
  }
}

// ─── Daily series (for the daily-revenue chart) ──────────────────────────────

export type DayPoint = { ymd: string; retail: number; b2b: number; total: number; gp: number }

export function dailySeries(receipts: DashReceipt[], fromYmd: string, toYmd: string): DayPoint[] {
  const byDay = new Map<string, DayPoint>()
  for (let d = fromYmd; d <= toYmd; d = addDays(d, 1)) byDay.set(d, { ymd: d, retail: 0, b2b: 0, total: 0, gp: 0 })
  for (const r of receipts) {
    const ymd = r.receipt_date.slice(0, 10)
    const p = byDay.get(ymd); if (!p) continue
    const sign = r.receipt_type === 'REFUND' ? -1 : 1
    const total = Number(r.total) * sign
    p.total += total
    p.gp += (Number(r.total) - Number(r.cost_total ?? 0)) * sign
    if (r.is_b2b) p.b2b += total; else p.retail += total
  }
  return [...byDay.values()]
}
