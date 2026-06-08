import { NextResponse } from 'next/server'
import { sbInventory, type WalletId } from '@/lib/supabase'

// Manual money movements for the Income/Cash ledger (inventory.money_movement).
//   POST   /api/m/income/movement   { occurred_on, kind, amount, ... } → create
//   DELETE /api/m/income/movement?id=...                               → delete

const WALLETS: WalletId[] = ['account', 'cash', 'personal']
const isWallet = (v: unknown): v is WalletId => typeof v === 'string' && (WALLETS as string[]).includes(v)
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const { occurred_on, kind, amount, wallet_id, from_wallet_id, to_wallet_id, note } = b

  if (!isDate(occurred_on)) return bad('occurred_on must be YYYY-MM-DD')
  if (kind !== 'inflow' && kind !== 'outflow' && kind !== 'transfer') return bad('kind must be inflow|outflow|transfer')
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) return bad('amount must be > 0')

  const row: Record<string, unknown> = {
    occurred_on, kind, amount: amt,
    note: note == null ? null : String(note).trim() || null,
    wallet_id: null, from_wallet_id: null, to_wallet_id: null,
  }

  if (kind === 'transfer') {
    if (!isWallet(from_wallet_id) || !isWallet(to_wallet_id)) return bad('transfer needs from_wallet_id and to_wallet_id')
    if (from_wallet_id === to_wallet_id) return bad('transfer wallets must differ')
    row.from_wallet_id = from_wallet_id
    row.to_wallet_id = to_wallet_id
  } else {
    if (!isWallet(wallet_id)) return bad('inflow/outflow needs wallet_id')
    row.wallet_id = wallet_id
  }

  const { data, error } = await sbInventory.from('money_movement').insert(row).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return bad('id required')
  const { error } = await sbInventory.from('money_movement').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

function bad(msg: string) { return NextResponse.json({ error: msg }, { status: 400 }) }
