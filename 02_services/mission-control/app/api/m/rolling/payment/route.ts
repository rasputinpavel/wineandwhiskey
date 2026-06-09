import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// Big one-off payments for the Rolling forecast (inventory.rolling_big_payment).
//   POST   /api/m/rolling/payment   { name, amount, due_date?, status?, note? }
//   PATCH  /api/m/rolling/payment   { id, ...fields }
//   DELETE /api/m/rolling/payment?id=...

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const { name, amount, due_date, status, note } = b
  if (typeof name !== 'string' || !name.trim()) return bad('name required')
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) return bad('amount must be > 0')
  if (due_date != null && due_date !== '' && !isDate(due_date)) return bad('due_date must be YYYY-MM-DD')
  const row = {
    name: name.trim(), amount: amt,
    due_date: due_date ? due_date : null,
    status: status === 'paid' ? 'paid' : 'planned',
    note: note == null ? null : String(note).trim() || null,
  }
  const { data, error } = await sbInventory.from('rolling_big_payment').insert(row).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const { id, name, amount, due_date, status, note } = b
  if (typeof id !== 'string') return bad('id required')
  const patch: Record<string, unknown> = {}
  if (name !== undefined) { if (!String(name).trim()) return bad('name must be non-empty'); patch.name = String(name).trim() }
  if (amount !== undefined) { const a = Number(amount); if (!Number.isFinite(a) || a <= 0) return bad('amount must be > 0'); patch.amount = a }
  if (due_date !== undefined) { if (due_date && !isDate(due_date)) return bad('due_date must be YYYY-MM-DD'); patch.due_date = due_date ? due_date : null }
  if (status !== undefined) patch.status = status === 'paid' ? 'paid' : 'planned'
  if (note !== undefined) patch.note = note == null ? null : String(note).trim() || null
  if (Object.keys(patch).length === 0) return bad('nothing to update')
  const { error } = await sbInventory.from('rolling_big_payment').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return bad('id required')
  const { error } = await sbInventory.from('rolling_big_payment').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

function bad(msg: string) { return NextResponse.json({ error: msg }, { status: 400 }) }
