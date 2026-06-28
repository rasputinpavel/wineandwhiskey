import { sbInventory, sbPublic, type MoneyWallet, type MoneyMovement, type FixedCost, type Supplier, type PurchaseOrder, type FlowInvoice, type RollingBigPayment } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { fmtThb, fmtThbCompact, todayBkk, computeDueDate } from '@/lib/kpi'
import { computeBalances, fetchExpenses, autoInflows, type IncomeReceipt, type WalletExpense } from '@/lib/income'
import { generateObligations, bucketOf, daysInMonth } from '@/lib/mandatory'
import { buildRolling, type DatedAmount } from '@/lib/rolling'
import { WeeklyTable, BigPaymentsPanel } from '@/components/modules/rolling/RollingClient'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { getReceiptHistory, receiptsFrom } from '@/lib/receipts-cache'

export const dynamic = 'force-dynamic'

const maxDate = (a: string, b: string) => (a > b ? a : b)
const addDays = (ymd: string, n: number) => {
  const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

export default async function RollingPage() {
  const today = todayBkk()

  // ─── Fetch ────────────────────────────────────────────────────────────────
  const [walletsRes, movementsRes, fixedRes, invoicesRes, suppliersRes, customersRes] = await Promise.all([
    sbInventory.from('money_wallet').select('*').order('sort_order', { ascending: true }),
    sbInventory.from('money_movement').select('*').limit(2000),
    sbInventory.from('fixed_cost').select('*'),
    sbInventory.from('flowaccount_invoice').select('total, status, due_at, issued_at, customer_id').neq('status', 'Cancelled').eq('excluded', false),
    sbInventory.from('supplier').select('id, name, type, payment_terms_days'),
    sbInventory.from('b2b_customer').select('id, payment_terms_days'),
  ])
  for (const r of [walletsRes, movementsRes, fixedRes, invoicesRes, suppliersRes, customersRes]) {
    if (r.error) return <SchemaError error={r.error.message} />
  }
  const wallets = (walletsRes.data ?? []) as MoneyWallet[]
  const movements = (movementsRes.data ?? []) as MoneyMovement[]

  // Receipts since the earliest opening date (for liquidity) — also covers the
  // last-7-days retail average. Reads the shared cached receipt history and
  // slices to this view's window.
  const sinceIso = (wallets.map(w => w.opening_date).sort()[0] ?? addDays(today, -30)) + 'T00:00:00Z'
  let receipts: IncomeReceipt[] = []
  try {
    receipts = receiptsFrom(await getReceiptHistory(), sinceIso) as IncomeReceipt[]
  } catch (e: unknown) {
    return <SchemaError error={String((e as { message?: string })?.message ?? e)} />
  }

  // Purchase orders (public schema) — for supplier payments (AP).
  const pos: Pick<PurchaseOrder, 'supplier' | 'total_thb' | 'order_date' | 'paid_at' | 'cashflow_override'>[] = []
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await sbPublic
      .from('purchase_orders')
      .select('supplier, total_thb, order_date, paid_at, cashflow_override')
      .order('order_date', { ascending: true }).range(from, from + 999)
    if (error) return <SchemaError error={error.message} />
    if (!data?.length) break
    pos.push(...data)
    if (data.length < 1000) break
  }

  // Big payments — tolerate a missing table (migration 026 not applied yet).
  let bigPayments: RollingBigPayment[] = []
  let bigError: string | null = null
  {
    const { data, error } = await sbInventory.from('rolling_big_payment').select('*')
    if (error) bigError = error.message
    else bigPayments = (data ?? []) as RollingBigPayment[]
  }

  // Expenses (Google sheet) for current liquidity.
  let expenses: WalletExpense[] = []
  let expensesError: string | null = null
  try { expenses = await fetchExpenses() } catch (e: unknown) { expensesError = String((e as { message?: string })?.message ?? e) }

  // ─── Derive forecast inputs ─────────────────────────────────────────────────
  const auto = autoInflows(receipts)
  const incomeSummary = computeBalances(wallets, movements, expenses, auto)
  // Liquidity = company money only (account + cash). The Personal wallet is the
  // owner's own pocket — tracked on the Income page so owner-paid expenses stay
  // visible, but it never counts toward business liquidity or the rolling chain.
  const openingLiquidity = incomeSummary.business
  const isBusiness = (w: string | null | undefined): boolean => w === 'account' || w === 'cash'

  // Avg retail/day over the trailing 7 days (B2C only, SALE − REFUND).
  const last7Start = addDays(today, -6)
  let retail7 = 0
  for (const r of receipts) {
    const d = r.receipt_date.slice(0, 10)
    if (d < last7Start || d > today || r.is_b2b) continue
    retail7 += (r.receipt_type === 'REFUND' ? -1 : 1) * Number(r.total)
  }
  const avgRetailPerDay = Math.max(0, retail7 / 7)

  // AR — unpaid invoices, expected on their due date. FlowAccount often leaves
  // due_at empty → fall back to issued_at + the customer's payment terms. Overdue
  // (or undated) collections are pulled to today.
  type Inv = Pick<FlowInvoice, 'total' | 'status' | 'due_at' | 'issued_at' | 'customer_id'>
  const custTerms = new Map<string, number>(((customersRes.data ?? []) as { id: string; payment_terms_days: number | null }[]).map(c => [c.id, c.payment_terms_days ?? 0]))
  const ar: DatedAmount[] = []
  for (const inv of (invoicesRes.data ?? []) as Inv[]) {
    if (inv.status === 'Paid') continue
    const terms = inv.customer_id ? (custTerms.get(inv.customer_id) ?? 30) : 30
    const expected = inv.due_at ? inv.due_at.slice(0, 10)
      : inv.issued_at ? computeDueDate(inv.issued_at.slice(0, 10), terms)
      : today
    ar.push({ date: maxDate(expected, today), amount: Number(inv.total) })
  }

  // AP — supplier payments. paid_at is the source of truth for "paid": a PO with
  // paid_at already left the bank (it's in current liquidity), so it's dropped.
  // A PO with no paid_at is still owed — scheduled on its due date, and if that
  // due date is already past (overdue) it's pulled to today so the forecast shows
  // the obligation instead of silently assuming it was paid. Consignment
  // suppliers excluded (accrual, not POs).
  type SupRow = Pick<Supplier, 'name' | 'type' | 'payment_terms_days'>
  const supByName = new Map<string, SupRow>(((suppliersRes.data ?? []) as SupRow[]).map(s => [s.name.trim().toLowerCase(), s]))
  const ap: DatedAmount[] = []
  for (const p of pos) {
    if (!p.order_date) continue
    const sup = p.supplier ? supByName.get(p.supplier.trim().toLowerCase()) : undefined
    if (sup?.type === 'consignment') continue
    if (p.cashflow_override === 'exclude') continue
    const amount = Number(p.total_thb ?? 0)
    if (p.paid_at) {
      const paid = p.paid_at.slice(0, 10)
      if (paid < today) continue            // already paid → reflected in liquidity
      ap.push({ date: paid, amount })        // payment scheduled for a future date
    } else {
      const due = computeDueDate(p.order_date, sup?.payment_terms_days ?? 0).slice(0, 10)
      ap.push({ date: maxDate(due, today), amount })  // unpaid; overdue → today
    }
  }

  // Big one-off payments — planned only, on their due date (overdue → today).
  const big: DatedAmount[] = []
  for (const b of bigPayments) {
    if (b.status === 'paid' || !b.due_date) continue
    big.push({ date: maxDate(b.due_date, today), amount: Number(b.amount) })
  }

  // Actual flows (dated) — used for closed weeks. Anchor = earliest wallet
  // opening; the chain reconciles with today's liquidity.
  const openingDate = wallets.map(w => w.opening_date).sort()[0] ?? today
  const openingBalance = wallets.filter(w => isBusiness(w.id)).reduce((s, w) => s + Number(w.opening_balance), 0)

  const revenueActual: DatedAmount[] = receipts.map(r => ({
    date: r.receipt_date.slice(0, 10),
    amount: (r.receipt_type === 'REFUND' ? -1 : 1) * Number(r.total),
  }))
  const manualInflows: DatedAmount[] = []
  const manualOutflows: DatedAmount[] = []
  const ownerIntake: DatedAmount[] = []
  for (const m of movements) {
    if (m.kind === 'inflow') {
      if (!isBusiness(m.wallet_id)) continue  // money landing in Personal isn't business liquidity
      ;(m.owner_contribution ? ownerIntake : manualInflows).push({ date: m.occurred_on, amount: Number(m.amount) })
    } else if (m.kind === 'outflow') {
      if (!isBusiness(m.wallet_id)) continue
      manualOutflows.push({ date: m.occurred_on, amount: Number(m.amount) })
    } else if (m.kind === 'transfer') {
      // Account↔Cash nets zero on business liquidity; a Personal↔business transfer
      // moves money in or out of the business and must be counted.
      const into = isBusiness(m.to_wallet_id), outOf = isBusiness(m.from_wallet_id)
      if (into && !outOf) manualInflows.push({ date: m.occurred_on, amount: Number(m.amount) })
      else if (outOf && !into) manualOutflows.push({ date: m.occurred_on, amount: Number(m.amount) })
    }
  }
  // Split actual expenses by the Expenses-sheet bucket (Обязательные /
  // Кредиторка / Операционные) so closed weeks break down correctly. Anything
  // uncategorised falls into operational.
  const fixedRows = (fixedRes.data ?? []) as FixedCost[]
  const mandatoryExpensesActual: DatedAmount[] = []
  const operationalExpensesActual: DatedAmount[] = []
  const payablesExpensesActual: DatedAmount[] = []
  for (const e of expenses) {
    if (!isBusiness(e.wallet)) continue  // owner-paid (Personal) expenses don't draw down business liquidity
    const d = { date: e.date, amount: e.amount }
    const b = bucketOf(e.category)
    if (b === 'mandatory') mandatoryExpensesActual.push(d)
    else if (b === 'payables') payablesExpensesActual.push(d)
    else operationalExpensesActual.push(d)
  }

  // Dated mandatory obligations across the whole horizon (forecast side). Revenue
  // for %-rows: actual for closed months, retail run-rate × month length ahead.
  const monthlyActual = new Map<string, number>()
  for (const r of receipts) {
    const ym = r.receipt_date.slice(0, 7)
    monthlyActual.set(ym, (monthlyActual.get(ym) ?? 0) + (r.receipt_type === 'REFUND' ? -1 : 1) * Number(r.total))
  }
  const curMonth = today.slice(0, 7)
  const revenueOfMonth = (ym: string) => ym < curMonth ? (monthlyActual.get(ym) ?? 0) : avgRetailPerDay * daysInMonth(ym)

  const addMonthYm = (ym: string, delta: number) => {
    const [y, mo] = ym.split('-').map(Number)
    const d = new Date(Date.UTC(y, mo - 1 + delta, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const mandatory: DatedAmount[] = []
  {
    const endYm = `${Math.max(Number(openingDate.slice(0, 4)), Number(today.slice(0, 4)))}-12`
    let ym = openingDate.slice(0, 7)
    let guard = 0
    while (ym <= endYm && guard++ < 60) {
      for (const o of generateObligations(ym, fixedRows, revenueOfMonth)) mandatory.push({ date: o.date, amount: o.planned })
      ym = addMonthYm(ym, 1)
    }
  }

  const forecast = buildRolling({
    today, openingBalance, openingDate,
    revenueActual, manualInflows, manualOutflows, ownerIntake,
    mandatoryExpensesActual, operationalExpensesActual, payablesExpensesActual,
    avgRetailPerDay, ar, ap, big, mandatory,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">Rolling cashflow</h2>
        <DataFreshness sources={['loyverse_receipts', 'flowaccount_invoices', 'purchase_orders']} />
      </div>

      {/* Runway summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Liquidity now" value={fmtThb(openingLiquidity)} accent
          sub={incomeSummary.ownerContributions > 0 ? `incl. ${fmtThb(incomeSummary.ownerContributions)} owner financing` : undefined} />
        <Stat label="Avg retail / day (7d)" value={fmtThb(avgRetailPerDay)} />
        <Stat label="Lowest weekly balance" value={fmtThbCompact(forecast.minClosing)} tone={forecast.minClosing < 0 ? 'neg' : undefined} />
        <Stat label="First negative week" value={forecast.firstNegative ?? '— none —'} tone={forecast.firstNegative ? 'neg' : undefined} />
      </div>

      {expensesError && <Banner tone="red">Expenses not loaded ({expensesError}). Liquidity excludes expense outflows. Set GOOGLE_* env.</Banner>}
      {bigError && <Banner tone="amber">Big payments not loaded ({bigError}). Apply migration 026.</Banner>}

      <WeeklyTable weeks={forecast.weeks} />

      <BigPaymentsPanel payments={[...bigPayments].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))} />

      <Footnote />
    </div>
  )
}

function Stat({ label, value, accent, tone, sub }: { label: string; value: string; accent?: boolean; tone?: 'neg'; sub?: string }) {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-sm p-4">
      <div className="overline text-graphite mb-1">{label}</div>
      <div className={`font-display text-2xl leading-none ${tone === 'neg' ? 'text-wine-red' : accent ? 'text-wine-red' : 'text-deep-black'}`}>{value}</div>
      {sub && <div className="text-[11px] text-amber-gold mt-1.5">↳ {sub}</div>}
    </div>
  )
}

function Banner({ tone, children }: { tone: 'red' | 'amber'; children: React.ReactNode }) {
  const cls = tone === 'red'
    ? 'text-wine-red bg-wine-red/5 border-wine-red/30'
    : 'text-amber-gold bg-amber-gold/10 border-amber-gold/40'
  return <div className={`text-xs border rounded-sm px-3 py-2 ${cls}`}>{children}</div>
}

function Footnote() {
  return (
    <div className="text-[11px] text-graphite leading-relaxed border-t border-pale-stone pt-4 space-y-1">
      <p>Plan / fact chain anchored at the Income opening balance. Each week: <span className="text-deep-black">opening + income + owner intake − outflow = closing</span>, carried forward.</p>
      <p><span className="bg-cream px-1 rounded-sm">fact</span> (closed weeks) use <span className="text-deep-black">actual</span> revenue (Loyverse B2C+B2B) and actual expenses. <span className="text-amber-gold bg-amber-gold/20 px-1 rounded-sm">this week</span> blends actual-so-far with the rest projected. <span className="border border-pale-stone px-1 rounded-sm">forecast</span> weeks project income (retail avg/day × days + AR due) and outflow split into <span className="text-deep-black">Mandatory</span> (dated obligations on their real dates), <span className="text-deep-black">Payables</span> (supplier POs due) and <span className="text-deep-black">Big</span> one-offs. Operational spend is never forecast — it shows only as fact on closed weeks. The breakdown sits under each Outflow figure.</p>
      <p><span className="text-amber-gold">Owner in</span> = owner financing, shown on its real week and folded into the closing balance, but kept out of business income. Follow <span className="text-deep-black">Closing</span> to see the runway. Supplier payments are assumed on supplier terms (no confirmed-payment signal in the data).</p>
    </div>
  )
}
