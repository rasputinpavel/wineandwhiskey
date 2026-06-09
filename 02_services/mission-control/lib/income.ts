// ════════════════════════════════════════════════════════════════════════════
// Income / Cash — wallet balances from manual movements + Expenses-sheet outflows.
//
// Three wallets (account / cash / personal). Balance forward from each wallet's
// opening_balance at opening_date:
//
//   balance = opening
//           + Σ inflow                (to this wallet)
//           + Σ transfer-in           (to this wallet)
//           − Σ transfer-out          (from this wallet)
//           − Σ outflow (manual)      (from this wallet)
//           − Σ expenses              (attributed to this wallet)
//
// Manual movements live in Supabase (inventory.money_movement). Expenses are NOT
// duplicated — they're read live from the Google Sheet "Expenses" (written by the
// ops bot) and attributed to a wallet by column H ('account'|'cash'|'personal');
// for legacy rows without H we fall back to column F ("Со счёта компании":
// TRUE → account, FALSE → personal).
// ════════════════════════════════════════════════════════════════════════════

import type { MoneyWallet, MoneyMovement, WalletId, LoyverseReceipt } from './supabase'

const SHEET_ID = '1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY'
const EXPENSES_RANGE = 'Expenses!A2:H'

export type WalletExpense = {
  date: string            // 'YYYY-MM-DD'
  amount: number
  description: string
  wallet: WalletId
  category: string
}

// ─── Google Sheets read ──────────────────────────────────────────────────────

async function googleToken(): Promise<string> {
  const client_id = process.env.GOOGLE_CLIENT_ID
  const client_secret = process.env.GOOGLE_CLIENT_SECRET
  const refresh_token = process.env.GOOGLE_REFRESH_TOKEN
  if (!client_id || !client_secret || !refresh_token) {
    throw new Error('Google Sheets credentials missing — set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN')
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' }),
  })
  if (!r.ok) throw new Error(`Google OAuth: ${await r.text()}`)
  return (await r.json()).access_token as string
}

// 'DD.MM.YYYY' (sheet) → 'YYYY-MM-DD'. Returns null on anything unparseable.
function parseSheetDate(s: string): string | null {
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/)
  if (!m) return null
  const dd = m[1].padStart(2, '0')
  const mm = m[2].padStart(2, '0')
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3]
  return `${yyyy}-${mm}-${dd}`
}

// Resolve a wallet from column H (preferred) or legacy column F flag.
function resolveWallet(hCell: string | undefined, fCell: string | undefined): WalletId {
  const h = (hCell ?? '').trim().toLowerCase()
  if (h === 'account' || h === 'счёт' || h === 'счет') return 'account'
  if (h === 'cash' || h === 'касса' || h === 'наличка') return 'cash'
  if (h === 'personal' || h === 'личный' || h === 'личные') return 'personal'
  // Legacy: F = "Со счёта компании" TRUE → account, else personal.
  return (fCell ?? '').trim().toUpperCase() === 'TRUE' ? 'account' : 'personal'
}

// Parse a number that may use a comma decimal separator and spaces ("2 660,55").
function parseAmount(s: string): number {
  const cleaned = String(s).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

export async function fetchExpenses(): Promise<WalletExpense[]> {
  const token = await googleToken()
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(EXPENSES_RANGE)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  )
  if (!r.ok) throw new Error(`Expenses read: ${await r.text()}`)
  const rows: string[][] = (await r.json()).values ?? []
  const out: WalletExpense[] = []
  for (const row of rows) {
    const date = parseSheetDate(row[0] ?? '')
    const amount = parseAmount(row[1] ?? '')
    if (!date || amount <= 0) continue
    out.push({
      date,
      amount,
      description: (row[2] ?? '').trim(),
      wallet: resolveWallet(row[7], row[5]),  // H, fallback F
      category: (row[6] ?? '').trim(),
    })
  }
  return out
}

// ─── Auto inflows from Loyverse sales ────────────────────────────────────────
// Sales land in a wallet by payment method: cash → Cash register, everything
// else (card / QR / bank transfer) → company Account. Signed by SALE/REFUND.

export type IncomeReceipt = Pick<LoyverseReceipt, 'receipt_date' | 'receipt_type' | 'total' | 'payment_method' | 'is_bank_transfer' | 'is_b2b'>
export type AutoInflow = { date: string; wallet: WalletId; amount: number }

// Which wallet a sale's money lands in.
export function receiptWallet(r: IncomeReceipt): WalletId {
  if (r.payment_method) return r.payment_method === 'cash' ? 'cash' : 'account'
  // Legacy rows (synced before payment_method existed): bank transfer / B2B → the
  // company account; assume the rest is cash B2C.
  return r.is_bank_transfer || r.is_b2b ? 'account' : 'cash'
}

export function autoInflows(receipts: IncomeReceipt[]): AutoInflow[] {
  return receipts.map(r => ({
    date: r.receipt_date.slice(0, 10),
    wallet: receiptWallet(r),
    amount: (r.receipt_type === 'REFUND' ? -1 : 1) * Number(r.total),
  }))
}

// ─── Balance computation ─────────────────────────────────────────────────────

export type WalletBalance = {
  id: WalletId
  name: string
  opening: number
  openingDate: string
  sales: number            // auto inflows from Loyverse
  inflow: number           // manual inflows (incl. owner contributions)
  ownerContrib: number     // owner financing — subset of inflow, surfaced separately
  transferIn: number
  transferOut: number
  outflowManual: number
  expenses: number
  balance: number
}

export type IncomeSummary = {
  wallets: WalletBalance[]
  byId: Record<WalletId, WalletBalance>
  total: number            // all three wallets (matches the sheet TOTAL)
  business: number         // account + cash (company liquidity for planning)
  ownerContributions: number // total owner financing folded into liquidity
}

export function computeBalances(
  wallets: MoneyWallet[],
  movements: MoneyMovement[],
  expenses: WalletExpense[],
  auto: AutoInflow[] = [],
): IncomeSummary {
  const rows: WalletBalance[] = wallets
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(w => {
      const since = w.opening_date
      const mv = movements.filter(m => m.occurred_on >= since)
      const sales = auto.filter(a => a.wallet === w.id && a.date >= since).reduce((s, a) => s + a.amount, 0)
      const inflowMv = mv.filter(m => m.kind === 'inflow' && m.wallet_id === w.id)
      const inflow = sum(inflowMv)
      const ownerContrib = sum(inflowMv.filter(m => m.owner_contribution))
      const outflowManual = sum(mv.filter(m => m.kind === 'outflow' && m.wallet_id === w.id))
      const transferIn = sum(mv.filter(m => m.kind === 'transfer' && m.to_wallet_id === w.id))
      const transferOut = sum(mv.filter(m => m.kind === 'transfer' && m.from_wallet_id === w.id))
      const exp = expenses.filter(e => e.wallet === w.id && e.date >= since).reduce((s, e) => s + e.amount, 0)
      const opening = Number(w.opening_balance)
      return {
        id: w.id, name: w.name, opening, openingDate: since,
        sales, inflow, ownerContrib, transferIn, transferOut, outflowManual, expenses: exp,
        balance: opening + sales + inflow + transferIn - transferOut - outflowManual - exp,
      }
    })

  const byId = Object.fromEntries(rows.map(r => [r.id, r])) as Record<WalletId, WalletBalance>
  const bal = (id: WalletId) => byId[id]?.balance ?? 0
  return {
    wallets: rows,
    byId,
    total: rows.reduce((s, r) => s + r.balance, 0),
    business: bal('account') + bal('cash'),
    ownerContributions: rows.reduce((s, r) => s + r.ownerContrib, 0),
  }
}

function sum(ms: MoneyMovement[]): number { return ms.reduce((s, m) => s + Number(m.amount), 0) }

// ─── Daily breakdown (per-day Δ + running balance per wallet) ────────────────
// Mirrors the Google Sheet "Income" tab: one row per active day with each
// wallet's net change and its running cumulative balance.

export type DayCell = { delta: number; balance: number }
export type DayBreakdown = {
  date: string
  account: DayCell
  cash: DayCell
  personal: DayCell
  total: number       // sum of the three running balances at end of day
}

export function dailyBreakdown(
  wallets: MoneyWallet[],
  movements: MoneyMovement[],
  expenses: WalletExpense[],
  today: string,
  auto: AutoInflow[] = [],
): DayBreakdown[] {
  const ids: WalletId[] = ['account', 'cash', 'personal']
  const opening: Record<WalletId, number> = { account: 0, cash: 0, personal: 0 }
  const openDate: Record<WalletId, string> = { account: today, cash: today, personal: today }
  for (const w of wallets) { opening[w.id] = Number(w.opening_balance); openDate[w.id] = w.opening_date }

  // Per-day, per-wallet net change (only on/after that wallet's opening date).
  const deltas = new Map<string, Record<WalletId, number>>()
  const bump = (date: string, id: WalletId, v: number) => {
    if (date < openDate[id] || date > today) return
    const row = deltas.get(date) ?? { account: 0, cash: 0, personal: 0 }
    row[id] += v
    deltas.set(date, row)
  }
  for (const m of movements) {
    if (m.kind === 'transfer') {
      bump(m.occurred_on, m.from_wallet_id as WalletId, -Number(m.amount))
      bump(m.occurred_on, m.to_wallet_id as WalletId, Number(m.amount))
    } else {
      bump(m.occurred_on, m.wallet_id as WalletId, (m.kind === 'inflow' ? 1 : -1) * Number(m.amount))
    }
  }
  for (const e of expenses) bump(e.date, e.wallet, -e.amount)
  for (const a of auto) bump(a.date, a.wallet, a.amount)

  // Continuous: one row per calendar day from the earliest opening date to today
  // (like the Google sheet), carrying the running balance even on empty days.
  const start = ids.map(id => openDate[id]).sort()[0]
  const running: Record<WalletId, number> = { ...opening }
  const out: DayBreakdown[] = []
  const ZERO = { account: 0, cash: 0, personal: 0 }
  for (let date = start; date <= today; date = addOneDay(date)) {
    const d = deltas.get(date) ?? ZERO
    for (const id of ids) running[id] += d[id]
    out.push({
      date,
      account: { delta: d.account, balance: running.account },
      cash: { delta: d.cash, balance: running.cash },
      personal: { delta: d.personal, balance: running.personal },
      total: running.account + running.cash + running.personal,
    })
  }
  return out
}

function addOneDay(ymd: string): string {
  const dt = new Date(ymd + 'T00:00:00Z')
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}

export const WALLET_LABELS: Record<WalletId, string> = {
  account: 'Account', cash: 'Cash', personal: 'Personal',
}
