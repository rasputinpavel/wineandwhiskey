import { NextResponse } from 'next/server'
import { sbInventory, type WalletId } from '@/lib/supabase'

// Edit a wallet's opening balance / date (inventory.money_wallet).
//   PATCH /api/m/income/wallet   { id, opening_balance?, opening_date? }

const WALLETS: WalletId[] = ['account', 'cash', 'personal']

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const { id, opening_balance, opening_date } = b
  if (typeof id !== 'string' || !(WALLETS as string[]).includes(id)) {
    return NextResponse.json({ error: 'id must be account|cash|personal' }, { status: 400 })
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (opening_balance !== undefined) {
    const n = Number(opening_balance)
    if (!Number.isFinite(n)) return NextResponse.json({ error: 'opening_balance must be a number' }, { status: 400 })
    patch.opening_balance = n
  }
  if (opening_date !== undefined) {
    if (typeof opening_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(opening_date)) {
      return NextResponse.json({ error: 'opening_date must be YYYY-MM-DD' }, { status: 400 })
    }
    patch.opening_date = opening_date
  }
  const { error } = await sbInventory.from('money_wallet').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
