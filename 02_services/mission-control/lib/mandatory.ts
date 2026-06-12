// ════════════════════════════════════════════════════════════════════════════
// Mandatory expenses — dated PLAN obligations + bucket-level reconciliation.
//
// The Expenses sheet groups every row into one of three buckets via its category
// column: Обязательные (mandatory), Операционные (operational), Кредиторка
// (payables). There is NO per-obligation granularity in the sheet — the detail
// (rent vs salary) lives only in free-text descriptions. So we reconcile at the
// BUCKET level: the fixed_cost rows are the mandatory PLAN (broken down for
// planning + Rolling/Calendar forecasting by date), while the actual mandatory
// spend is the sheet's whole "Обязательные" bucket total. Per-obligation fact
// comes only from manual overrides.
// ════════════════════════════════════════════════════════════════════════════

import type { FixedCost, MandatoryActual } from './supabase'
import type { WalletExpense } from './income'

// ─── Expense buckets ─────────────────────────────────────────────────────────
// Match the Expenses-sheet category column exactly (case-insensitive).
export const EXPENSE_BUCKETS = {
  mandatory:   'обязательные',
  operational: 'операционные',
  payables:    'кредиторка',
} as const
export type BucketKey = keyof typeof EXPENSE_BUCKETS

export function bucketOf(category: string): BucketKey | null {
  const c = category.trim().toLowerCase()
  for (const k of Object.keys(EXPENSE_BUCKETS) as BucketKey[]) if (EXPENSE_BUCKETS[k] === c) return k
  return null
}

type ExpenseRow = Pick<WalletExpense, 'date' | 'amount' | 'category'>

// Σ Expenses-sheet rows in `period` (YYYY-MM) that fall in the given bucket.
export function sumBucket(expenses: ExpenseRow[], period: string, key: BucketKey): number {
  return expenses.reduce((s, e) => (e.date.slice(0, 7) === period && bucketOf(e.category) === key ? s + e.amount : s), 0)
}

// ─── Date helpers ('YYYY-MM' / 'YYYY-MM-DD', UTC-anchored) ───────────────────

export function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function obligationDate(period: string, dueDay: number): string {
  const day = Math.min(Math.max(dueDay, 1), daysInMonth(period))
  return `${period}-${String(day).padStart(2, '0')}`
}

// ─── Dated plan obligations from the template ────────────────────────────────

export type Obligation = {
  fixedCostId: string
  category: string
  period: string            // 'YYYY-MM'
  date: string              // period + due_day (clamped to month length)
  planned: number           // flat amount_thb, or percent_revenue × revenue(period)
}

// Only active rows WITH a due_day become dated obligations; undated rows are
// surfaced separately in the tracker. revenueOfMonth(period) → actual for closed
// months, forecast for current/future (caller decides).
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
    }))
}

// ─── Per-obligation status — overrides only ──────────────────────────────────
// The sheet can't be split per obligation, so an obligation is "paid" only when
// a manual override says so; otherwise its status is by date vs today. Actual
// mandatory spend at the bucket level comes from sumBucket(…, 'mandatory').

export type ReconcileStatus = 'paid' | 'overdue' | 'pending'

export type Reconciled = Obligation & {
  actual: number | null     // manual override amount, else null (no per-row sheet fact)
  paidAt: string | null
  status: ReconcileStatus
  source: 'override' | null
}

export function applyOverrides(obs: Obligation[], overrides: MandatoryActual[], today: string): Reconciled[] {
  const byKey = new Map(overrides.map(o => [`${o.fixed_cost_id}::${o.period}`, o]))
  return obs.map(o => {
    const ov = byKey.get(`${o.fixedCostId}::${o.period}`)
    const status: ReconcileStatus = ov?.paid ? 'paid' : o.date < today ? 'overdue' : 'pending'
    return {
      ...o,
      actual: ov && ov.amount_thb != null ? Number(ov.amount_thb) : null,
      paidAt: ov?.paid_at ?? null,
      status,
      source: ov ? 'override' : null,
    }
  })
}
