import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

export async function PATCH(req: Request) {
  const { id, payment_terms_days, credit_limit, notes, is_consignment, group_id, loyverse_customer_id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof payment_terms_days === 'number')   patch.payment_terms_days = payment_terms_days
  if (credit_limit === null || typeof credit_limit === 'number') patch.credit_limit = credit_limit
  if (typeof notes === 'string' || notes === null) patch.notes = notes
  if (typeof is_consignment === 'boolean')      patch.is_consignment = is_consignment
  if (loyverse_customer_id === null || typeof loyverse_customer_id === 'string') {
    patch.loyverse_customer_id = loyverse_customer_id || null
  }

  // group_id: null = вынуть из группы; uuid = добавить в группу.
  if (group_id === null || (typeof group_id === 'string' && group_id.length > 0)) {
    if (group_id) {
      const { data: g, error: gErr } = await sbInventory
        .from('b2b_customer_group')
        .select('id')
        .eq('id', group_id)
        .maybeSingle()
      if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 })
      if (!g)   return NextResponse.json({ error: 'group_id not found' }, { status: 400 })
    }
    patch.group_id = group_id
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
