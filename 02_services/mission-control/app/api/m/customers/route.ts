import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

export async function PATCH(req: Request) {
  const { id, payment_terms_days, credit_limit, notes, is_consignment, parent_id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof payment_terms_days === 'number')   patch.payment_terms_days = payment_terms_days
  if (credit_limit === null || typeof credit_limit === 'number') patch.credit_limit = credit_limit
  if (typeof notes === 'string' || notes === null) patch.notes = notes
  if (typeof is_consignment === 'boolean')      patch.is_consignment = is_consignment

  // parent_id: null = снять связь; uuid = привязать как branch.
  // Защита:
  //   • parent_id ≠ id (саморефернс)
  //   • parent сам не должен быть branch (избегаем 2+ уровня иерархии)
  if (parent_id === null || (typeof parent_id === 'string' && parent_id.length > 0)) {
    if (parent_id === id) return NextResponse.json({ error: 'parent_id cannot equal id' }, { status: 400 })
    if (parent_id) {
      const { data: parentCust, error: pErr } = await sbInventory
        .from('b2b_customer')
        .select('parent_id')
        .eq('id', parent_id)
        .maybeSingle()
      if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
      if (!parentCust) return NextResponse.json({ error: 'parent_id not found' }, { status: 400 })
      if (parentCust.parent_id) return NextResponse.json({ error: 'parent must be top-level (cannot link to a branch)' }, { status: 400 })
    }
    patch.parent_id = parent_id
  }

  const { error } = await sbInventory
    .from('b2b_customer')
    .update(patch)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-provision a consignment_location row when a customer is flipped to
  // consignment, so the Deliveries tab works immediately. Idempotent.
  if (is_consignment === true) {
    const { data: existing } = await sbInventory
      .from('consignment_location')
      .select('id')
      .eq('customer_id', id)
      .maybeSingle()
    if (!existing) {
      const { data: cust } = await sbInventory
        .from('b2b_customer')
        .select('flowaccount_name')
        .eq('id', id)
        .single()
      await sbInventory
        .from('consignment_location')
        .insert({ customer_id: id, name: cust?.flowaccount_name ?? 'Consignment' })
    }
  }

  return NextResponse.json({ ok: true })
}
