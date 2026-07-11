import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/price/supabase'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabase
    .from('catalog_updates').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

// Discard an open review: no mutation of wine_items.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data: cu, error: getErr } = await supabase
    .from('catalog_updates').select('new_price_list_id,status').eq('id', id).single()
  if (getErr || !cu) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (cu.status !== 'pending_review')
    return NextResponse.json({ error: `cannot discard a ${cu.status} update` }, { status: 409 })

  await supabase.from('catalog_updates').update({ status: 'discarded' }).eq('id', id)
  if (cu.new_price_list_id)
    await supabase.from('price_lists').update({ status: 'error', error_message: 'Update discarded' })
      .eq('id', cu.new_price_list_id)
  return NextResponse.json({ ok: true })
}
