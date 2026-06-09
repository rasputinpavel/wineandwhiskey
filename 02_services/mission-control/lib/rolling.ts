// ════════════════════════════════════════════════════════════════════════════
// Rolling cashflow — forward weekly forecast to year-end.
//
// Native port of the Google-Sheet "Rolling" tab. Forecast only (history lives in
// Dashboard / Income): the chain starts at today's liquidity and projects each
// week's closing balance forward, so you can see which week runs tight.
//
//   period 1   = [today … Sunday of this week]   (partial)
//   period 2…N = full Mon–Sun weeks until Dec 31
//
//   income   = retail projection (avg retail/day × days) + AR collected (B2B
//              invoices due in the period)
//   outflow  = supplier payments due (AP) + fixed costs (pro-rated) + big
//              one-off payments scheduled in the period
//   closing  = opening + income − outflow,  carried as next period's opening
//
// All source extraction (AP payment dates, unpaid invoices, fixed model, big
// payments) happens in the page; this module just buckets dated amounts and
// runs the chain — pure and testable.
// ════════════════════════════════════════════════════════════════════════════

const DAYS_PER_MONTH_AVG = 365 / 12
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type DatedAmount = { date: string; amount: number }
export type RollingFixed = { baseMonthly: number; pctRate: number }

export type RollingWeek = {
  start: string
  end: string
  label: string
  days: number
  opening: number
  retailProj: number
  ar: number
  ap: number
  fixed: number
  big: number
  income: number
  outflow: number
  closing: number
}

export type RollingForecast = {
  weeks: RollingWeek[]
  minClosing: number
  firstNegative: string | null   // label of first week the balance goes < 0
}

// ─── Date helpers ('YYYY-MM-DD', UTC-anchored) ───────────────────────────────

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function dow(ymd: string): number { return new Date(ymd + 'T00:00:00Z').getUTCDay() } // 0=Sun
function sundayOf(ymd: string): string { return addDays(ymd, (7 - dow(ymd)) % 7) }
function daysInclusive(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86_400_000) + 1
}
function label(start: string, end: string): string {
  const [, sm, sd] = start.split('-').map(Number)
  const [, em, ed] = end.split('-').map(Number)
  return sm === em ? `${MONTH_ABBR[sm - 1]} ${sd}–${ed}` : `${MONTH_ABBR[sm - 1]} ${sd} – ${MONTH_ABBR[em - 1]} ${ed}`
}

// Generate forecast periods: partial current week, then full Mon–Sun to Dec 31.
export function forecastPeriods(today: string): { start: string; end: string }[] {
  const yearEnd = `${today.slice(0, 4)}-12-31`
  const out: { start: string; end: string }[] = []
  let start = today
  while (start <= yearEnd) {
    const end = minStr(sundayOf(start), yearEnd)
    out.push({ start, end })
    start = addDays(end, 1)
  }
  return out
}
function minStr(a: string, b: string): string { return a < b ? a : b }

function sumIn(items: DatedAmount[], from: string, to: string): number {
  return items.reduce((s, it) => (it.date >= from && it.date <= to ? s + it.amount : s), 0)
}

export function buildRolling(input: {
  today: string
  openingLiquidity: number
  avgRetailPerDay: number
  ar: DatedAmount[]
  ap: DatedAmount[]
  big: DatedAmount[]
  fixed: RollingFixed
}): RollingForecast {
  const { today, openingLiquidity, avgRetailPerDay, ar, ap, big, fixed } = input
  const periods = forecastPeriods(today)
  const weeks: RollingWeek[] = []
  let opening = openingLiquidity
  let minClosing = openingLiquidity
  let firstNegative: string | null = null

  for (const p of periods) {
    const days = daysInclusive(p.start, p.end)
    const retailProj = avgRetailPerDay * days
    const arSum = sumIn(ar, p.start, p.end)
    const apSum = sumIn(ap, p.start, p.end)
    const bigSum = sumIn(big, p.start, p.end)
    const fixedSum = fixed.baseMonthly * (days / DAYS_PER_MONTH_AVG) + fixed.pctRate * retailProj
    const income = retailProj + arSum
    const outflow = apSum + fixedSum + bigSum
    const closing = opening + income - outflow
    const lbl = label(p.start, p.end)
    if (closing < minClosing) minClosing = closing
    if (firstNegative === null && closing < 0) firstNegative = lbl
    weeks.push({
      start: p.start, end: p.end, label: lbl, days,
      opening, retailProj, ar: arSum, ap: apSum, fixed: fixedSum, big: bigSum,
      income, outflow, closing,
    })
    opening = closing
  }
  return { weeks, minClosing, firstNegative }
}
