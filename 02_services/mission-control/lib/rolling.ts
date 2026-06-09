// ════════════════════════════════════════════════════════════════════════════
// Rolling cashflow — weekly plan/fact chain, anchored at the Income opening.
//
// Starts at the wallet opening balance/date (the reconciled anchor) and chains
// every Mon–Sun week to year-end. Each day in a week is treated as ACTUAL if it
// is before today, PROJECTED if today-or-later — so a week automatically flips
// from forecast to fact as it closes, and the running balance recomputes on real
// numbers:
//
//   ACTUAL  (day < today):  revenue (Loyverse B2C+B2B) + manual in − manual out
//                           − expenses (sheet); owner contributions surfaced.
//   PROJECT (day ≥ today):  retail avg/day × days + AR due − supplier (AP) due
//                           − fixed (pro-rated) − big payments.
//
//   closing = opening + income + owner intake − outflow,  carried forward.
//
// The last actual day's running balance reconciles with today's liquidity, so
// fact (closed weeks) and forecast (ahead) join seamlessly at today.
// ════════════════════════════════════════════════════════════════════════════

const DAYS_PER_MONTH_AVG = 365 / 12
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type DatedAmount = { date: string; amount: number }
export type RollingFixed = { baseMonthly: number; pctRate: number }
export type WeekStatus = 'closed' | 'current' | 'forecast'

export type RollingWeek = {
  start: string
  end: string
  label: string
  status: WeekStatus
  opening: number
  income: number           // business income (actual revenue or retail+AR projection)
  incomeNote: string       // breakdown for tooltip
  ownerIntake: number      // owner financing (not business income)
  outflow: number
  outflowNote: string
  closing: number
}

export type RollingForecast = {
  weeks: RollingWeek[]
  minClosing: number        // lowest closing across current+future weeks
  firstNegative: string | null
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
  if (to < from) return 0
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86_400_000) + 1
}
function label(start: string, end: string): string {
  const [, sm, sd] = start.split('-').map(Number)
  const [, em, ed] = end.split('-').map(Number)
  return sm === em ? `${MONTH_ABBR[sm - 1]} ${sd}–${ed}` : `${MONTH_ABBR[sm - 1]} ${sd} – ${MONTH_ABBR[em - 1]} ${ed}`
}
const minStr = (a: string, b: string) => (a < b ? a : b)

// Weeks: first one starts at `start` (may be a partial week), then full Mon–Sun
// until Dec 31 of the start year-or-later.
function periodsFrom(start: string): { s: string; e: string }[] {
  const yearEnd = `${Math.max(Number(start.slice(0, 4)), new Date().getUTCFullYear())}-12-31`
  const out: { s: string; e: string }[] = []
  let s = start
  let guard = 0
  while (s <= yearEnd && guard++ < 100) {
    out.push({ s, e: minStr(sundayOf(s), yearEnd) })
    s = addDays(minStr(sundayOf(s), yearEnd), 1)
  }
  return out
}

// Σ amounts dated in [from,to] and matching the actual/projected side of `today`.
function sumSide(items: DatedAmount[], from: string, to: string, today: string, side: 'actual' | 'proj'): number {
  return items.reduce((acc, it) => {
    if (it.date < from || it.date > to) return acc
    const isActual = it.date < today
    if (side === 'actual' ? isActual : !isActual) return acc + it.amount
    return acc
  }, 0)
}

const fmt = (n: number) => '฿' + Math.round(n).toLocaleString('en-US')

export function buildRolling(input: {
  today: string
  openingBalance: number
  openingDate: string
  // actuals (dated):
  revenueActual: DatedAmount[]
  manualInflows: DatedAmount[]
  manualOutflows: DatedAmount[]
  ownerIntake: DatedAmount[]
  expensesActual: DatedAmount[]
  // projection inputs:
  avgRetailPerDay: number
  ar: DatedAmount[]
  ap: DatedAmount[]
  big: DatedAmount[]
  fixed: RollingFixed
}): RollingForecast {
  const { today, openingBalance, openingDate, revenueActual, manualInflows, manualOutflows,
    ownerIntake, expensesActual, avgRetailPerDay, ar, ap, big, fixed } = input

  const periods = periodsFrom(openingDate)
  const weeks: RollingWeek[] = []
  let opening = openingBalance
  let minClosing = Infinity
  let firstNegative: string | null = null

  for (const p of periods) {
    const status: WeekStatus = p.e < today ? 'closed' : p.s > today ? 'forecast' : 'current'
    const futureDays = p.e >= today ? daysInclusive(minStr(p.s, today) < today ? today : p.s, p.e) : 0

    // Income — actual revenue (before today) + projection (today on).
    const revAct = sumSide(revenueActual, p.s, p.e, today, 'actual')
    const inAct = sumSide(manualInflows, p.s, p.e, today, 'actual')
    const retailProj = avgRetailPerDay * futureDays
    const arProj = sumSide(ar, p.s, p.e, today, 'proj')
    const income = revAct + inAct + retailProj + arProj

    // Owner intake — actual contributions this week (+ any future-dated).
    const ownerIn = sumSide(ownerIntake, p.s, p.e, today, 'actual') + sumSide(ownerIntake, p.s, p.e, today, 'proj')

    // Outflow — actual expenses/withdrawals (before today) + projection (today on).
    const expAct = sumSide(expensesActual, p.s, p.e, today, 'actual')
    const outAct = sumSide(manualOutflows, p.s, p.e, today, 'actual')
    const apProj = sumSide(ap, p.s, p.e, today, 'proj')
    const fixedProj = fixed.baseMonthly * (futureDays / DAYS_PER_MONTH_AVG) + fixed.pctRate * retailProj
    const bigProj = sumSide(big, p.s, p.e, today, 'proj')
    const outflow = expAct + outAct + apProj + fixedProj + bigProj

    const closing = opening + income + ownerIn - outflow

    const incomeNote = status === 'closed'
      ? `actual revenue ${fmt(revAct + inAct)}`
      : `retail ${fmt(retailProj)}${arProj ? ` + AR ${fmt(arProj)}` : ''}${revAct + inAct ? ` + actual ${fmt(revAct + inAct)}` : ''}`
    const outflowNote = status === 'closed'
      ? `actual expenses ${fmt(expAct + outAct)}`
      : `${apProj ? `supplier ${fmt(apProj)} · ` : ''}fixed ${fmt(fixedProj)}${bigProj ? ` · big ${fmt(bigProj)}` : ''}${expAct + outAct ? ` · actual ${fmt(expAct + outAct)}` : ''}`

    if (status !== 'closed') {
      if (closing < minClosing) minClosing = closing
      if (firstNegative === null && closing < 0) firstNegative = label(p.s, p.e)
    }

    weeks.push({
      start: p.s, end: p.e, label: label(p.s, p.e), status,
      opening, income, incomeNote, ownerIntake: ownerIn, outflow, outflowNote, closing,
    })
    opening = closing
  }

  return { weeks, minClosing: Number.isFinite(minClosing) ? minClosing : openingBalance, firstNegative }
}
