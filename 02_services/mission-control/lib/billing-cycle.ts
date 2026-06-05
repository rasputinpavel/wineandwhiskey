// Supplier billing-cycle period math — the SINGLE home for it.
//
// Owner-sensitive: a supplier's billing cycle may start on a day other than the
// 1st (Harvest settles 5th-to-5th). For period "YYYY-MM" the cycle covers
// [startDay of that month, startDay of the next month) — i.e. "05 → 04 of next
// month inclusive". Both the consignment Monthly Report and its sales-detail
// page must use this one function so the settlement window can never drift.
//
// Boundaries are at Bangkok-local midnight (store is UTC+7, no DST). This matters:
// a sale on the 5th (Bangkok) must land in the NEW cycle, so the cutoff is
// 05th 00:00 Bangkok = 04th 17:00 UTC — NOT UTC midnight (which is 07:00 Bangkok
// and would leak early-morning 5th sales into the previous month).
//
// Returns:
//   startIso / endExclIso — UTC timestamps, for receipt_date (timestamptz) filters
//   startDate / endExclDate — "YYYY-MM-DD" calendar bounds, for date columns
//                             (e.g. consignment_delivery.delivered_at)

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000

export function cyclePeriodRange(
  period: string,
  startDay: number,
): { startIso: string; endExclIso: string; startDate: string; endExclDate: string; label: string } {
  const [y, m] = period.split('-').map(Number)
  const d = Math.min(28, Math.max(1, Math.round(startDay) || 1))

  // Bangkok-local midnight of day d → UTC timestamp.
  const start = new Date(Date.UTC(y, m - 1, d) - BANGKOK_OFFSET_MS)
  const endExcl = new Date(Date.UTC(y, m, d) - BANGKOK_OFFSET_MS) // day d of the next month

  // Calendar date bounds (the literal 5th-to-5th), for date-typed columns.
  const pad = (n: number) => String(n).padStart(2, '0')
  const endY = m === 12 ? y + 1 : y
  const endM = m === 12 ? 1 : m + 1
  const startDate = `${y}-${pad(m)}-${pad(d)}`
  const endExclDate = `${endY}-${pad(endM)}-${pad(d)}`

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  // Inclusive end = day before the next cycle start (e.g. "5 May – 4 Jun 2026").
  const label = d === 1
    ? `${MON[m - 1]} ${y}`
    : `${d} ${MON[m - 1]} – ${d - 1} ${MON[m % 12]} ${endY}`
  return { startIso: start.toISOString(), endExclIso: endExcl.toISOString(), startDate, endExclDate, label }
}
