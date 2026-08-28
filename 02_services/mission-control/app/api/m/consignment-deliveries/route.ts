import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// CRUD for inventory.consignment_delivery — stock arrivals booked outside POs.
//
//   GET    ?supplier_id= [&from=YYYY-MM-DD&to=YYYY-MM-DD]  → list (desc by date)
//   POST   { supplier_id, delivered_at, note?, lines: [{sku_id, qty}] } → create a
//          whole delivery in one call. The legacy single-line shape
//          { supplier_id, sku_id, delivered_at, qty, note? } still works.
//   DELETE ?id=…                                            → delete one line
//   DELETE ?group=1&supplier_id=&delivered_at=[&note=]      → delete a whole delivery
//
// There is no delivery-note header table: a "delivery" is just the set of rows
// sharing (supplier_id, delivered_at, note) — note carries the supplier's TDN
// number. Keep that grouping key in sync with the deliveries page.

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
  const { supplier_id, delivered_at, note } = body
  if (typeof supplier_id !== 'string' || !supplier_id) return NextResponse.json({ error: 'supplier_id required' }, { status: 400 })
  if (typeof delivered_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(delivered_at)) return NextResponse.json({ error: 'delivered_at YYYY-MM-DD required' }, { status: 400 })

  // Accept either a batch of lines or the original single-line body.
  const rawLines = Array.isArray(body.lines)
    ? body.lines
    : [{ sku_id: body.sku_id, qty: body.qty }]
  if (rawLines.length === 0) return NextResponse.json({ error: 'at least one line required' }, { status: 400 })

  const rows: Record<string, unknown>[] = []
  for (const [i, l] of rawLines.entries()) {
    const where = rawLines.length > 1 ? ` (line ${i + 1})` : ''
    if (typeof l?.sku_id !== 'string' || !l.sku_id) return NextResponse.json({ error: `sku_id required${where}` }, { status: 400 })
    const n = Number(l.qty)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n === 0) return NextResponse.json({ error: `qty must be a non-zero integer${where}` }, { status: 400 })
    const row: Record<string, unknown> = { supplier_id, sku_id: l.sku_id, delivered_at, qty: n }
    if (note !== undefined) row.note = note === null ? null : String(note)
    rows.push(row)
  }

  // One SKU twice in the same delivery would otherwise become two rows that
  // read as a duplicate in the table — reject instead of silently merging.
  const skuIds = rows.map(r => r.sku_id as string)
  if (new Set(skuIds).size !== skuIds.length) {
    return NextResponse.json({ error: 'the same SKU appears twice — merge the lines' }, { status: 400 })
  }

  const { data, error } = await sbInventory.from('consignment_delivery').insert(rows).select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [], item: data?.[0] ?? null })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)

  if (url.searchParams.get('group')) {
    const supplier_id = url.searchParams.get('supplier_id')
    const delivered_at = url.searchParams.get('delivered_at')
    if (!supplier_id) return NextResponse.json({ error: 'supplier_id required' }, { status: 400 })
    if (!delivered_at || !/^\d{4}-\d{2}-\d{2}$/.test(delivered_at)) return NextResponse.json({ error: 'delivered_at YYYY-MM-DD required' }, { status: 400 })
    const note = url.searchParams.get('note')
    let q = sbInventory.from('consignment_delivery').delete()
      .eq('supplier_id', supplier_id).eq('delivered_at', delivered_at)
    q = note === null || note === '' ? q.is('note', null) : q.eq('note', note)
    const { error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 })
  const { error } = await sbInventory.from('consignment_delivery').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
