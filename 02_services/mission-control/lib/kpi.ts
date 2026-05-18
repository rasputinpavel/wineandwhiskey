// KPI Pulse helpers — period ranges (Bangkok time), AR aging buckets, money fmt.
//
// Everything lives in BKK time (UTC+7) because that's how the store closes the
// books. "MTD" means "1st of the current Bangkok month, 00:00 BKK → now".

const BKK_OFFSET_MIN = 7 * 60

export type Period = 'today' | 'wtd' | 'mtd' | 'last_month'

export type PeriodRange = {
  key: Period
  label: string
  fromISO: string   // inclusive, BKK midnight, expressed in UTC ISO
  toISO: string     // exclusive, BKK midnight (next day / next period start)
  fromDate: string  // YYYY-MM-DD in BKK (for date-typed columns like issued_at)
  toDate: string    // YYYY-MM-DD in BKK, exclusive
}

// Build a UTC instant from a BKK wall-clock date.
function bkkUtc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d, 0, 0, 0) - BKK_OFFSET_MIN * 60_000)
}

function bkkParts(now = new Date()): { y: number; m: number; d: number; weekday: number } {
  const t = new Date(now.getTime() + BKK_OFFSET_MIN * 60_000)
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth(),
    d: t.getUTCDate(),
    weekday: t.getUTCDay(),  // 0 = Sun
  }
}

function isoDate(d: Date): string {
  const t = new Date(d.getTime() + BKK_OFFSET_MIN * 60_000)
  return t.toISOString().slice(0, 10)
}

export function periodRange(key: Period, now = new Date()): PeriodRange {
  const { y, m, d, weekday } = bkkParts(now)
  let fromUtc: Date
  let toUtc: Date
  let label: string

  switch (key) {
    case 'today': {
      fromUtc = bkkUtc(y, m, d)
      toUtc   = bkkUtc(y, m, d + 1)
      label   = 'Today'
      break
    }
    case 'wtd': {
      // Week starts Monday (BKK convention).
      const daysSinceMonday = (weekday + 6) % 7
      fromUtc = bkkUtc(y, m, d - daysSinceMonday)
      toUtc   = bkkUtc(y, m, d + 1)
      label   = 'WTD'
      break
    }
    case 'mtd': {
      fromUtc = bkkUtc(y, m, 1)
      toUtc   = bkkUtc(y, m, d + 1)
      label   = 'MTD'
      break
    }
    case 'last_month': {
      fromUtc = bkkUtc(y, m - 1, 1)
      toUtc   = bkkUtc(y, m, 1)
      label   = 'Last month'
      break
    }
  }
  return {
    key,
    label,
    fromISO:  fromUtc.toISOString(),
    toISO:    toUtc.toISOString(),
    fromDate: isoDate(fromUtc),
    toDate:   isoDate(toUtc),
  }
}

// Trailing N days ending today (BKK). Used for sparklines / trend charts.
export function trailingDays(n: number, now = new Date()): { fromISO: string; toISO: string; days: string[] } {
  const { y, m, d } = bkkParts(now)
  const days: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    days.push(isoDate(bkkUtc(y, m, d - i)))
  }
  return {
    fromISO: bkkUtc(y, m, d - n + 1).toISOString(),
    toISO:   bkkUtc(y, m, d + 1).toISOString(),
    days,
  }
}

// Bucket label and order for AR aging.
export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+'
export const AGING_BUCKETS: AgingBucket[] = ['current', '1-30', '31-60', '61-90', '90+']
export const AGING_LABELS: Record<AgingBucket, string> = {
  current: 'Current',
  '1-30':  '1-30 d',
  '31-60': '31-60 d',
  '61-90': '61-90 d',
  '90+':   '90+ d',
}

// Bucket an invoice by days past due. Positive = overdue, 0 or negative = current.
export function agingBucket(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0)  return 'current'
  if (daysPastDue <= 30) return '1-30'
  if (daysPastDue <= 60) return '31-60'
  if (daysPastDue <= 90) return '61-90'
  return '90+'
}

// Days between two ISO dates (a - b), based on UTC midnight.
export function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO + 'T00:00:00Z').getTime()
  const b = new Date(bISO + 'T00:00:00Z').getTime()
  return Math.round((a - b) / 86_400_000)
}

// Due date from issued_at + payment_terms_days (terms <=0 means "due immediately").
export function computeDueDate(issuedAt: string, termsDays: number): string {
  const d = new Date(issuedAt + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + Math.max(0, termsDays))
  return d.toISOString().slice(0, 10)
}

// Money formatting: ฿1,234,567 (no decimals — wine pricing is whole-baht).
export function fmtThb(n: number): string {
  const abs = Math.abs(Math.round(n))
  const s = abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return (n < 0 ? '-฿' : '฿') + s
}

// Compact money: ฿1.2M / ฿345K / ฿1,234. Used inside dense KPI cards.
export function fmtThbCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}฿${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 10_000)    return `${sign}฿${Math.round(abs / 1000)}K`
  return fmtThb(n)
}

export function fmtPct(num: number, den: number, digits = 1): string {
  if (!den) return '—'
  return ((num / den) * 100).toFixed(digits) + '%'
}

export function todayBkk(now = new Date()): string {
  const { y, m, d } = bkkParts(now)
  return isoDate(bkkUtc(y, m, d))
}

// YYYY-MM-DD in BKK for N days ago.
export function isoNDaysAgo(n: number, now = new Date()): string {
  const { y, m, d } = bkkParts(now)
  return isoDate(bkkUtc(y, m, d - n))
}
