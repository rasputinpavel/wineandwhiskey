import { NextResponse } from 'next/server'
import { sbPublic } from '@/lib/supabase'

// PATCH /api/m/purchases — toggle exclude_from_cashflow on one PO.
// Body: { id: number, exclude_from_cashflow: boolean }

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { id, exclude_from_cashflow } = body
  if (typeof id !== 'number') return NextResponse.json({ error: 'id (number) required' }, { status: 400 })
  if (typeof exclude_from_cashflow !== 'boolean') {
    return NextResponse.json({ error: 'exclude_from_cashflow (boolean) required' }, { status: 400 })
  }

  const { error } = await sbPublic
    .from('purchase_orders')
    .update({ exclude_from_cashflow })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
