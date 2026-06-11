import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// Manual overrides of a mandatory obligation's actual (inventory.mandatory_actual).
// A row exists only when the owner corrects the auto-matched fact; deleting it
// reverts to the live Expenses-sheet match.
//
//   GET    /api/m/mandatory-actual?month=YYYY-MM            → overrides for the month
//   PUT    /api/m/mandatory-actual  { fixed_cost_id, period, paid?, amount_thb?, paid_at?, note? }
//                                                           → upsert (on fixed_cost_id+period)
//   DELETE /api/m/mandatory-actual?fixed_cost_id=..&period=YYYY-MM → revert to sheet match

const MONTH_RE = /^\d{4}-\d{2}$/

export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get('month')
  let q = sbInventory.from('mandatory_actual').select('*')
  if (month) {
    if (!MONTH_RE.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
    q = q.eq('period', month)
  }
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { fixed_cost_id, period, paid, amount_thb, paid_at, note } = body

  if (typeof fixed_cost_id !== 'string' || !fixed_cost_id) {
    return NextResponse.json({ error: 'fixed_cost_id (string) required' }, { status: 400 })
  }
  if (typeof period !== 'string' || !MONTH_RE.test(period)) {
    return NextResponse.json({ error: 'period (YYYY-MM) required' }, { status: 400 })
  }

  const row: Record<string, unknown> = { fixed_cost_id, period, updated_at: new Date().toISOString() }
  row.paid = !!paid
  if (amount_thb !== undefined) {
    if (amount_thb === null) row.amount_thb = null
    else {
      const n = Number(amount_thb)
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'amount_thb must be ≥0 or null' }, { status: 400 })
      row.amount_thb = n
    }
  }
  if (paid_at !== undefined) row.paid_at = paid_at === null || paid_at === '' ? null : String(paid_at)
  if (note !== undefined)    row.note    = note === null ? null : String(note)

  const { data, error } = await sbInventory
    .from('mandatory_actual')
    .upsert(row, { onConflict: 'fixed_cost_id,period' })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const fixed_cost_id = url.searchParams.get('fixed_cost_id')
  const period = url.searchParams.get('period')
  if (!fixed_cost_id || !period) {
    return NextResponse.json({ error: 'fixed_cost_id and period query params required' }, { status: 400 })
  }
  const { error } = await sbInventory
    .from('mandatory_actual')
    .delete()
    .eq('fixed_cost_id', fixed_cost_id)
    .eq('period', period)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
