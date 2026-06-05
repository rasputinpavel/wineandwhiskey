// Supplier billing-cycle period math — the SINGLE home for it.
//
// Owner-sensitive: a supplier's billing cycle may start on a day other than the
// 1st (Harvest settles 5th-to-5th). For period "YYYY-MM" the cycle covers
// [startDay of that month, startDay of the next month). Both the consignment
// Monthly Report and its sales-detail page must use this one function so the
// settlement window can never drift between the two screens.

export function cyclePeriodRange(
  period: string,
  startDay: number,
): { startIso: string; endExclIso: string; label: string } {
  const [y, m] = period.split('-').map(Number)
  const d = Math.min(28, Math.max(1, Math.round(startDay) || 1))
  const start = new Date(Date.UTC(y, m - 1, d))
  const endExcl = new Date(Date.UTC(y, m, d)) // day d of the next month
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const endY = m === 12 ? y + 1 : y
  const label = d === 1
    ? `${MON[m - 1]} ${y}`
    : `${d} ${MON[m - 1]} – ${d} ${MON[m % 12]} ${endY}`
  return { startIso: start.toISOString(), endExclIso: endExcl.toISOString(), label }
}
