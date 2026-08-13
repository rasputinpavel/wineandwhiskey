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

// ─── Category ↔ sheet-description matching ───────────────────────────────────
// The Expenses sheet has no per-obligation link, but its free-text description
// almost always names the category (RU or EN). We match a plan line to an actual
// payment by keyword so a paid obligation drops out of the forecast — no manual
// tick needed. Keep the lists tight: a keyword must not bleed across categories
// (e.g. "аванс" for Salary Advance must not fire on a plain "зарплата" row).
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'rent':           ['rent', 'аренд', 'ренд'],
  'utilities':      ['utilit', 'коммунал', 'комунал'],
  'salary advance': ['advance', 'аванс'],
  // Bonuses are paid inside the regular salary run, so any salary payment covers
  // them too (hence the salary keywords here alongside the bonus-specific ones).
  'salary bonuses': ['bonus', 'бонус', 'преми', 'salary', 'зарплат', 'оклад'],
  'salary':         ['salary', 'зарплат', 'оклад'],
  'taxes':          ['tax', 'налог', 'ндс', 'vat'],
  'accounting':     ['account', 'бухгалт', 'бухучёт', 'бухучет'],
}

// True when `description` names the plan `category` (case-insensitive keyword hit).
export function descriptionMatchesCategory(description: string, category: string): boolean {
  const keys = CATEGORY_KEYWORDS[category.trim().toLowerCase()]
  if (!keys) return false
  const d = description.toLowerCase()
  return keys.some(k => d.includes(k))
}

// Reconcile ONE month's mandatory plan against that month's actual "Обязательные"
// sheet rows (their descriptions). Returns the forecast-side dated amounts:
//   • obligations matched to an actual (already paid) are dropped — the payment
//     is already counted on the actual side, so keeping the plan line would
//     double-count it;
//   • unpaid obligations survive, and an unpaid one whose due date has passed is
//     pulled to `today` (like AP/big) so overdue mandatory never silently vanishes.
export function reconcileMonthObligations(
  obligations: Obligation[],
  actualDescriptions: string[],
  today: string,
): { date: string; amount: number }[] {
  const out: { date: string; amount: number }[] = []
  for (const o of obligations) {
    const paid = actualDescriptions.some(d => descriptionMatchesCategory(d, o.category))
    if (paid) continue
    // overdue (date < today) → today, so unpaid past obligations don't vanish.
    out.push({ date: o.date < today ? today : o.date, amount: o.planned })
  }
  return out
}
