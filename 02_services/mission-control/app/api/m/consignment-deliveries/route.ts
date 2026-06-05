import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// CRUD for inventory.consignment_delivery — stock arrivals booked outside POs.
//
//   GET    ?supplier_id= [&from=YYYY-MM-DD&to=YYYY-MM-DD]  → list (desc by date)
//   POST   { supplier_id, sku_id, delivered_at, qty, note? } → create
//   DELETE ?id=…                                             → delete

export async function GET(req: Request) {
  const url = new URL(req.url)
  const supplier_id = url.searchParams.get('supplier_id')
  if (!supplier_id) return NextResponse.json({ error: 'supplier_id required' }, { status: 400 })
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  let q = sbInventory
    .from('consignment_delivery')
    .select('id, sku_id, delivered_at, qty, note, sku:sku(name, loyverse_product_code)')
    .eq('supplier_id', supplier_id)
  if (from) q = q.gte('delivered_at', from)
  if (to) q = q.lt('delivered_at', to)
  const { data, error } = await q.order('delivered_at', { ascending: false }).limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { supplier_id, sku_id, delivered_at, qty, note } = body
  if (typeof supplier_id !== 'string' || !supplier_id) return NextResponse.json({ error: 'supplier_id required' }, { status: 400 })
  if (typeof sku_id !== 'string' || !sku_id) return NextResponse.json({ error: 'sku_id required' }, { status: 400 })
  if (typeof delivered_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(delivered_at)) return NextResponse.json({ error: 'delivered_at YYYY-MM-DD required' }, { status: 400 })
  const n = Number(qty)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n === 0) return NextResponse.json({ error: 'qty must be a non-zero integer' }, { status: 400 })

  const row: Record<string, unknown> = { supplier_id, sku_id, delivered_at, qty: n }
  if (note !== undefined) row.note = note === null ? null : String(note)
  const { data, error } = await sbInventory.from('consignment_delivery').insert(row).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 })
  const { error } = await sbInventory.from('consignment_delivery').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
