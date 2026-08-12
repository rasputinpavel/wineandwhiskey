import type { RollingBigPayment, FixedCost, MandatoryActual } from './supabase'
import type { CalRow, Status } from '@/components/modules/payment-calendar/Timeline'
import { daysInMonth } from './mandatory'

// ── Date helpers ('YYYY-MM' / 'YYYY-MM-DD', UTC-anchored) ────────────────────
function addMonth(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function endOfMonth(period: string): string {
  return `${period}-${String(daysInMonth(period)).padStart(2, '0')}`
}
const maxDate = (a: string, b: string) => (a > b ? a : b)

// Status of an OUT obligation by its date vs today (never 'paid' — caller decides that).
export function outStatus(date: string, today: string): Exclude<Status, 'paid'> {
  if (date < today) return 'overdue'
  if (date === today) return 'today'
  return 'future'
}

export type CalMode =
  | { view: 'open'; today: string }
  | { view: 'month'; month: string; today: string }

// Horizon end for the Open view: end of next month (current + next month).
function openHorizonEnd(today: string): string {
  return endOfMonth(addMonth(today.slice(0, 7), 1))
}

export function buildBigRows(bigPayments: RollingBigPayment[], mode: CalMode): CalRow[] {
  const out: CalRow[] = []
  for (const b of bigPayments) {
    if (!b.due_date) continue
    const paid = b.status === 'paid'
    if (mode.view === 'month') {
      if (b.due_date.slice(0, 7) !== mode.month) continue
      out.push(bigRow(b, b.due_date, paid ? 'paid' : outStatus(b.due_date, mode.today)))
    } else {
      if (paid) continue                                    // open shows outstanding only
      const date = maxDate(b.due_date, mode.today)          // overdue → today
      if (date > openHorizonEnd(mode.today)) continue       // beyond current+next month
      out.push(bigRow(b, date, outStatus(date, mode.today)))
    }
  }
  return out
}

function bigRow(b: RollingBigPayment, date: string, status: Status): CalRow {
  return {
    key: `big-${b.id}`, date, dir: 'out', who: b.name, label: b.name,
    href: null, amount: Number(b.amount ?? 0), status, net: 0,
    big: { id: b.id, paid: b.status === 'paid' },
  }
}

function clampDay(period: string, day: number): string {
  const d = Math.min(Math.max(day, 1), daysInMonth(period))
  return `${period}-${String(d).padStart(2, '0')}`
}

// Planned amount for an obligation in `period`: flat amount, or percent × revenue.
function plannedAmount(fc: FixedCost, period: string, revenueOf: (p: string) => number): number {
  return fc.percent_revenue != null
    ? (Number(fc.percent_revenue) / 100) * revenueOf(period)
    : Number(fc.amount_thb ?? 0)
}

export function buildFixedRows(
  fixedCosts: FixedCost[],
  overrides: MandatoryActual[],
  revenueOf: (period: string) => number,
  mode: CalMode,
): CalRow[] {
  const active = fixedCosts.filter(f => f.active && f.due_day != null)
  const ovByKey = new Map(overrides.map(o => [`${o.fixed_cost_id}::${o.period}`, o]))
  const out: CalRow[] = []

  for (const fc of active) {
    const day = fc.due_day as number
    if (mode.view === 'month') {
      const period = mode.month
      out.push(fixedRow(fc, period, day, ovByKey.get(`${fc.id}::${period}`), revenueOf, mode.today))
    } else {
      const cur = mode.today.slice(0, 7)
      const curDate = clampDay(cur, day)
      const curOv = ovByKey.get(`${fc.id}::${cur}`)
      // Current month occurrence still upcoming AND not paid → use it; else roll to next month.
      const useCurrent = curDate >= mode.today && !curOv?.paid
      const period = useCurrent ? cur : addMonth(cur, 1)
      out.push(fixedRow(fc, period, day, ovByKey.get(`${fc.id}::${period}`), revenueOf, mode.today))
    }
  }
  return out
}

function fixedRow(
  fc: FixedCost, period: string, day: number,
  ov: MandatoryActual | undefined,
  revenueOf: (p: string) => number, today: string,
): CalRow {
  const planned = plannedAmount(fc, period, revenueOf)
  const amount = ov && ov.amount_thb != null ? Number(ov.amount_thb) : planned
  const paid = !!ov?.paid
  // Paid rows sit on paid_at; if an override marks paid but omits paid_at, fall back to the due date.
  const date = paid && ov?.paid_at ? ov.paid_at.slice(0, 10) : clampDay(period, day)
  const status: Status = paid ? 'paid' : outStatus(date, today)
  return {
    key: `fixed-${fc.id}-${period}`, date, dir: 'out', who: fc.category, label: fc.category,
    href: null, amount, status, net: 0,
    fixed: { fixedCostId: fc.id, period, paid },
  }
}
