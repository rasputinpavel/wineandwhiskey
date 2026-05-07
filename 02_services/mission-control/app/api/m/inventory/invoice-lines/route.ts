import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

export async function PATCH(req: Request) {
  const { id, sku_id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (sku_id !== null && typeof sku_id !== 'string') {
    return NextResponse.json({ error: 'sku_id must be string or null' }, { status: 400 })
  }

  const { error } = await sbInventory
    .from('flowaccount_invoice_line')
    .update({ sku_id })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
