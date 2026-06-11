// ════════════════════════════════════════════════════════════════════════════
// Mandatory expenses — dated obligations + plan/fact reconciliation.
//
// The fixed_cost rows are a monthly TEMPLATE. For a given month we expand each
// active row that has a due_day into one dated obligation (rent on the 15th,
// salary on the 3rd, taxes ~10th), with a planned amount (flat THB, or
// percent_revenue × that month's revenue). We then reconcile each obligation to
// FACT: a manual override wins, otherwise we auto-match the Expenses sheet by
// category, otherwise it's still unpaid (overdue/pending vs today).
//
// Single home of this logic — consumed by the Fixed Costs tracker, Rolling, the
// Payment Calendar, and Pulse.
// ════════════════════════════════════════════════════════════════════════════

import type { FixedCost, MandatoryActual } from './supabase'
import type { WalletExpense } from './income'

export type Obligation = {
  fixedCostId: string
  category: string
  period: string            // 'YYYY-MM'
  date: string              // 'YYYY-MM-DD' — period + due_day (clamped to month length)
  planned: number           // flat amount_thb, or percent_revenue × revenue(period)
  matchLabels: string[]     // lowercased Expenses-sheet categories that reconcile to this row
}

export type ReconcileStatus = 'paid' | 'overdue' | 'pending'

export type Reconciled = Obligation & {
  actual: number | null     // override amount, else Expenses-sheet sum, else null
  paidAt: string | null
  status: ReconcileStatus
  source: 'override' | 'sheet' | null
}

// ─── Date helpers ('YYYY-MM' / 'YYYY-MM-DD', UTC-anchored) ───────────────────

export function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()   // day 0 of next month = last day of this
}

// period + day, clamped to the month's length, zero-padded.
function obligationDate(period: string, dueDay: number): string {
  const day = Math.min(Math.max(dueDay, 1), daysInMonth(period))
  return `${period}-${String(day).padStart(2, '0')}`
}

// ─── Match labels ────────────────────────────────────────────────────────────

// The Expenses-sheet categories that reconcile to a fixed-cost row: explicit
// comma-separated match_category aliases, else the row's own category.
export function matchLabelsFor(row: Pick<FixedCost, 'category' | 'match_category'>): string[] {
  const raw = row.match_category?.trim() ? row.match_category : row.category
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

// The set of all mandatory match labels across active rows — used to split
// Expenses-sheet rows into mandatory vs operational.
export function mandatoryLabelSet(rows: Pick<FixedCost, 'category' | 'match_category' | 'active'>[]): Set<string> {
  const set = new Set<string>()
  for (const r of rows) if (r.active) for (const l of matchLabelsFor(r)) set.add(l)
  return set
}

export function isMandatoryExpense(expenseCategory: string, labels: Set<string>): boolean {
  return labels.has(expenseCategory.trim().toLowerCase())
}

// ─── Generate dated obligations for a month ──────────────────────────────────

// Only active rows WITH a due_day become dated obligations; undated rows fall
// back to the legacy smear (handled by Rolling) and are surfaced separately in
// the tracker. revenueOfMonth(period) → actual for closed months, forecast for
// current/future (caller decides).
export function generateObligations(
  period: string,
  rows: FixedCost[],
  revenueOfMonth: (period: string) => number,
): Obligation[] {
  const rev = revenueOfMonth(period)
  return rows
    .filter(r => r.active && r.due_day != null)
    .map(r => ({
      fixedCostId: r.id,
      category: r.category,
      period,
      date: obligationDate(period, r.due_day as number),
      planned: r.percent_revenue != null
        ? (Number(r.percent_revenue) / 100) * rev
        : Number(r.amount_thb ?? 0),
      matchLabels: matchLabelsFor(r),
    }))
}

// ─── Reconcile plan → fact ───────────────────────────────────────────────────

export function reconcile(
  obs: Obligation[],
  expenses: Pick<WalletExpense, 'date' | 'amount' | 'category'>[],
  overrides: MandatoryActual[],
  today: string,
): Reconciled[] {
  const ovByKey = new Map(overrides.map(o => [`${o.fixed_cost_id}::${o.period}`, o]))

  return obs.map(ob => {
    // Expenses-sheet rows in this period matching the obligation's categories.
    const matched = expenses.filter(e =>
      e.date.slice(0, 7) === ob.period && ob.matchLabels.includes(e.category.trim().toLowerCase()))
    const sheetSum = matched.reduce((s, e) => s + e.amount, 0)
    const sheetDate = matched.reduce<string | null>((d, e) => (d == null || e.date > d ? e.date : d), null)

    const ov = ovByKey.get(`${ob.fixedCostId}::${ob.period}`)
    if (ov) {
      const actual = ov.amount_thb != null ? Number(ov.amount_thb) : (matched.length ? sheetSum : null)
      const paidAt = ov.paid_at ?? sheetDate
      const status: ReconcileStatus = ov.paid ? 'paid' : ob.date < today ? 'overdue' : 'pending'
      return { ...ob, actual, paidAt, status, source: 'override' }
    }

    if (matched.length) {
      return { ...ob, actual: sheetSum, paidAt: sheetDate, status: 'paid', source: 'sheet' }
    }

    return { ...ob, actual: null, paidAt: null, status: ob.date < today ? 'overdue' : 'pending', source: null }
  })
}
