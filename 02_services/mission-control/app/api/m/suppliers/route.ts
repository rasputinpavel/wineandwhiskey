import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

const VALID_TYPES = new Set(['regular', 'consignment', 'mix'])

export async function PATCH(req: Request) {
  const { id, payment_terms_days, type, notes } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof payment_terms_days === 'number') patch.payment_terms_days = payment_terms_days
  if (typeof type === 'string') {
    if (!VALID_TYPES.has(type)) {
      return NextResponse.json({ error: `type must be one of ${[...VALID_TYPES].join(', ')}` }, { status: 400 })
    }
    patch.type = type
  }
  if (typeof notes === 'string' || notes === null) patch.notes = notes

  const { error } = await sbInventory
    .from('supplier')
    .update(patch)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
