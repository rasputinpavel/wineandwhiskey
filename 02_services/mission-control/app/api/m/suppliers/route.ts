import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

export async function PATCH(req: Request) {
  const { id, payment_terms_days, is_consignment, notes } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof payment_terms_days === 'number') patch.payment_terms_days = payment_terms_days
  if (typeof is_consignment === 'boolean')    patch.is_consignment = is_consignment
  if (typeof notes === 'string' || notes === null) patch.notes = notes

  const { error } = await sbInventory
    .from('supplier')
    .update(patch)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
