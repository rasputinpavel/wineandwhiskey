import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

export async function PATCH(req: Request) {
  const { id, sku_id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (sku_id !== null && typeof sku_id !== 'string') {
    return NextResponse.json({ error: 'sku_id must be string or null' }, { status: 400 })
  }

  // Mark it as a human ruling. The sync deletes and re-inserts an invoice's
  // lines every time it re-reads the detail page, and re-derives sku_id from
  // the fuzzy matcher — which is exactly why this row needed a person. Without
  // the flag the next run silently undoes what was just saved. Clearing to
  // null counts too: "this line is not a SKU" is also a decision.
  const { error } = await sbInventory
    .from('flowaccount_invoice_line')
    .update({ sku_id, sku_id_manual: true })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
