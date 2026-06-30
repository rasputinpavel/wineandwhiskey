import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// CRUD for inventory.consignment_price.
//
//   GET    ?supplier_id=…     → list rows for one supplier
//   POST   { supplier_id, sku_id, price_hc, price_retail?, notes? } → create
//   PATCH  { id, ...fields }                                         → update
//   DELETE ?id=…                                                     → delete

export async function GET(req: Request) {
  const url = new URL(req.url)
  const supplierId = url.searchParams.get('supplier_id')
  if (!supplierId) return NextResponse.json({ error: 'supplier_id query param required' }, { status: 400 })

  const { data, error } = await sbInventory
    .from('consignment_price')
    .select('id, supplier_id, sku_id, price_hc, price_retail, notes, created_at, updated_at')
    .eq('supplier_id', supplierId)
    .order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { supplier_id, sku_id, price_hc, price_retail, notes } = body
  if (typeof supplier_id !== 'string' || !supplier_id)
    return NextResponse.json({ error: 'supplier_id required' }, { status: 400 })
  if (typeof sku_id !== 'string' || !sku_id)
    return NextResponse.json({ error: 'sku_id required' }, { status: 400 })
  const hasHc = price_hc !== undefined && price_hc !== null
  if (hasHc && (typeof price_hc !== 'number' || !Number.isFinite(price_hc) || price_hc < 0))
    return NextResponse.json({ error: 'price_hc must be a non-negative number' }, { status: 400 })
  const hasRetail = price_retail !== undefined && price_retail !== null
  if (hasRetail && (typeof price_retail !== 'number' || !Number.isFinite(price_retail) || price_retail < 0))
    return NextResponse.json({ error: 'price_retail must be a non-negative number' }, { status: 400 })
  if (!hasHc && !hasRetail)
    return NextResponse.json({ error: 'price_hc or price_retail required' }, { status: 400 })

  const row: Record<string, unknown> = { supplier_id, sku_id }
  if (hasHc)     row.price_hc     = price_hc
  if (hasRetail) row.price_retail = Number(price_retail)
  if (notes !== undefined) row.notes = notes === null ? null : String(notes)

  // Upsert by (supplier_id, sku_id) so re-adding the same SKU is idempotent.
  const { data, error } = await sbInventory
    .from('consignment_price')
    .upsert(row, { onConflict: 'supplier_id,sku_id' })
    .select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { id, price_hc, price_retail, notes } = body
  if (typeof id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (price_hc !== undefined) {
    if (typeof price_hc !== 'number' || !Number.isFinite(price_hc) || price_hc < 0)
      return NextResponse.json({ error: 'price_hc must be non-negative number' }, { status: 400 })
    patch.price_hc = price_hc
  }
  if (price_retail !== undefined) patch.price_retail = price_retail === null ? null : Number(price_retail)
  if (notes !== undefined)        patch.notes        = notes === null ? null : String(notes)
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: 'no fields to update' }, { status: 400 })

  const { error } = await sbInventory.from('consignment_price').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 })

  const { error } = await sbInventory.from('consignment_price').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
