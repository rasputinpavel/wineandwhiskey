import { sbInventory, type MoneyWallet, type MoneyMovement, type WalletId, type LoyverseReceipt } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { fmtThb, todayBkk } from '@/lib/kpi'
import { computeBalances, dailyBreakdown, fetchExpenses, autoInflows, WALLET_LABELS, type WalletExpense, type WalletBalance, type IncomeReceipt } from '@/lib/income'
import { MovementForm, WalletOpeningCell } from '@/components/modules/income/IncomeControls'
import { LedgerTable, DailyTable, type LedgerRowData } from '@/components/modules/income/IncomeTables'

export const dynamic = 'force-dynamic'

export default async function IncomePage() {
  const today = todayBkk()

  const [walletsRes, movementsRes] = await Promise.all([
    sbInventory.from('money_wallet').select('*').order('sort_order', { ascending: true }),
    sbInventory.from('money_movement').select('*').order('occurred_on', { ascending: false }).limit(1000),
  ])
  if (walletsRes.error) return <SchemaError error={walletsRes.error.message} />
  if (movementsRes.error) return <SchemaError error={movementsRes.error.message} />

  const wallets = (walletsRes.data ?? []) as MoneyWallet[]
  const movements = (movementsRes.data ?? []) as MoneyMovement[]

  // Auto inflows from Loyverse sales, from the earliest wallet opening date.
  // PostgREST caps at 1000 rows → page through. Tolerate a missing
  // payment_method column (migration 025 not applied yet) by warning, not crashing.
  const sinceIso = (wallets.map(w => w.opening_date).sort()[0] ?? today) + 'T00:00:00Z'
  const receipts: IncomeReceipt[] = []
  let salesError: string | null = null
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await sbInventory
      .from('loyverse_receipt')
      .select('receipt_date, receipt_type, total, payment_method, is_bank_transfer, is_b2b')
      .gte('receipt_date', sinceIso)
      .order('receipt_date', { ascending: true })
      .range(from, from + 999)
    if (error) { salesError = error.message; break }
    if (!data?.length) break
    receipts.push(...(data as IncomeReceipt[]))
    if (data.length < 1000) break
  }
  const auto = autoInflows(receipts)

  // Expenses are read live from the Google Sheet — tolerate a missing-creds /
  // network failure by showing balances without them plus a warning.
  let expenses: WalletExpense[] = []
  let expensesError: string | null = null
  try { expenses = await fetchExpenses() }
  catch (e: unknown) { expensesError = String((e as { message?: string })?.message ?? e) }

  const summary = computeBalances(wallets, movements, expenses, auto)
  const daily = dailyBreakdown(wallets, movements, expenses, today, auto)

  // Combined ledger rows (manual movements + sheet expenses) — sorting/search
  // happen client-side in <LedgerTable>.
  const ledgerRows: LedgerRowData[] = []
  for (const m of movements) {
    if (m.kind === 'transfer') {
      ledgerRows.push({
        date: m.occurred_on, label: m.note || 'Transfer',
        tag: `${WALLET_LABELS[m.from_wallet_id as WalletId]} → ${WALLET_LABELS[m.to_wallet_id as WalletId]}`,
        amount: m.amount, amountText: fmtThb(m.amount), negative: false, manualId: m.id,
      })
    } else {
      const w = WALLET_LABELS[m.wallet_id as WalletId]
      const inflow = m.kind === 'inflow'
      ledgerRows.push({
        date: m.occurred_on, label: m.note || (inflow ? 'Income' : 'Withdrawal'),
        tag: inflow ? `→ ${w}` : `${w} →`,
        amount: inflow ? m.amount : -m.amount,
        amountText: (inflow ? '+' : '−') + fmtThb(m.amount), negative: !inflow, manualId: m.id,
      })
    }
  }
  for (const e of expenses) {
    ledgerRows.push({
      date: e.date, label: e.description || 'Expense',
      tag: `${WALLET_LABELS[e.wallet]} · ${e.category || 'expense'}`,
      amount: -e.amount, amountText: '−' + fmtThb(e.amount), negative: true, manualId: null,
    })
  }

  return (
    <div className="space-y-6">
      <h2 className="font-heading text-xl text-deep-black">Income / Cash</h2>

      {/* Wallet balances */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {summary.wallets.map(w => <WalletCard key={w.id} w={w} />)}
      </div>

      {/* Liquidity */}
      <div className="bg-deep-black text-warm-white rounded-sm p-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div>
          <div className="overline text-pale-stone mb-1">Liquidity · total</div>
          <div className="font-display text-3xl leading-none">{fmtThb(summary.total)}</div>
        </div>
        <div>
          <div className="overline text-pale-stone mb-1">Business (account + cash)</div>
          <div className="font-display text-2xl leading-none">{fmtThb(summary.business)}</div>
        </div>
      </div>

      {expensesError && (
        <div className="text-xs text-wine-red bg-wine-red/5 border border-wine-red/30 rounded-sm px-3 py-2">
          Expenses not loaded ({expensesError}). Balances exclude expense outflows. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN.
        </div>
      )}
      {salesError && (
        <div className="text-xs text-amber-gold bg-amber-gold/10 border border-amber-gold/40 rounded-sm px-3 py-2">
          Sales not loaded ({salesError}). Apply migration 025 (payment_method) and backfill receipts to auto-pull sales inflows.
        </div>
      )}

      <MovementForm today={today} />

      <LedgerTable rows={ledgerRows} />

      <DailyTable days={daily} />

      <Footnote />
    </div>
  )
}

// ─── Wallet card ─────────────────────────────────────────────────────────────

function WalletCard({ w }: { w: WalletBalance }) {
  return (
    <div className="bg-warm-white border border-pale-stone rounded-sm p-4">
      <div className="overline text-graphite mb-1">{WALLET_LABELS[w.id]}</div>
      <div className={`font-display text-2xl leading-none ${w.balance < 0 ? 'text-wine-red' : 'text-deep-black'}`}>{fmtThb(w.balance)}</div>
      <div className="mt-2">
        <WalletOpeningCell id={w.id} balance={w.opening} date={w.openingDate} />
      </div>
      <div className="mt-2 text-[10px] text-graphite leading-relaxed border-t border-pale-stone/60 pt-1.5">
        {w.sales !== 0 && <Line label="sales" v={Math.abs(w.sales)} sign={w.sales < 0 ? '−' : '+'} />}
        {w.inflow > 0 && <Line label="in (manual)" v={w.inflow} sign="+" />}
        {w.transferIn > 0 && <Line label="transfer in" v={w.transferIn} sign="+" />}
        {w.transferOut > 0 && <Line label="transfer out" v={w.transferOut} sign="−" />}
        {w.outflowManual > 0 && <Line label="withdrawn" v={w.outflowManual} sign="−" />}
        {w.expenses > 0 && <Line label="expenses" v={w.expenses} sign="−" />}
      </div>
    </div>
  )
}

function Line({ label, v, sign }: { label: string; v: number; sign: '+' | '−' }) {
  return <div className="flex justify-between"><span>{label}</span><span className={sign === '−' ? 'text-wine-red' : 'text-deep-black'}>{sign}{fmtThb(v).replace('฿', '฿')}</span></div>
}

function Footnote() {
  return (
    <div className="text-[11px] text-graphite leading-relaxed border-t border-pale-stone pt-4 space-y-1">
      <p>Three wallets — <span className="text-deep-black">Account</span> (company bank), <span className="text-deep-black">Cash</span> (register), <span className="text-deep-black">Personal</span> (owner). Balance = opening + sales + manual income + transfers in − transfers out − withdrawals − expenses.</p>
      <p><span className="text-deep-black">Sales</span> are pulled automatically from Loyverse — cash → Cash, card / QR / bank transfer → Account. <span className="text-deep-black">Expenses</span> come from the bot&apos;s Google-Sheet Expenses tab, attributed to a wallet. You only enter <span className="text-deep-black">transfers</span> between wallets (e.g. cash → account) and the occasional manual income / withdrawal.</p>
    </div>
  )
}
