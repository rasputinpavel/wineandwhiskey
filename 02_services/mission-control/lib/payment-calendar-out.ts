import type { RollingBigPayment } from './supabase'
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
