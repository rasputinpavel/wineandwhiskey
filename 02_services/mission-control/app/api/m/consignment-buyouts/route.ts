import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// CRUD for inventory.consignment_buyout — units bought OUT of a consignment
// pool onto our own books (migration 042).
//
//   GET    ?supplier_id=                                    → list (desc by date)
//   POST   { supplier_id, bought_at, invoice_no?, note?,
//            lines: [{sku_id, qty, unit_price?}] }          → one invoice in one call
//   DELETE ?id=…                                            → delete one line
//   DELETE ?group=1&supplier_id=&bought_at=[&invoice_no=]   → delete a whole invoice
//
// Like deliveries, there is no header table: an invoice is the set of rows
// sharing (supplier_id, bought_at, invoice_no). Keep that grouping key in sync
// with the buyouts page and lib/consignment-settlement.ts.
//
// unit_price is the PRE-VAT price printed on the buyout invoice — usually below
// the consignment HC, which is the point of buying out.

export async function GET(req: Request) {
  const url = new URL(req.url)
  const supplier_id = url.searchParams.get('supplier_id')
  if (!supplier_id) return NextResponse.json({ error: 'supplier_id required' }, { status: 400 })

  const { data, error } = await sbInventory
    .from('consignment_buyout')
    .select('id, sku_id, bought_at, qty, unit_price, invoice_no, note, sku:sku(name, loyverse_product_code)')
    .eq('supplier_id', supplier_id)
    .order('bought_at', { ascending: false })
    .limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { supplier_id, bought_at, invoice_no, note } = body
  if (typeof supplier_id !== 'string' || !supplier_id) return NextResponse.json({ error: 'supplier_id required' }, { status: 400 })
  if (typeof bought_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(bought_at)) return NextResponse.json({ error: 'bought_at YYYY-MM-DD required' }, { status: 400 })

  const rawLines = Array.isArray(body.lines) ? body.lines : [{ sku_id: body.sku_id, qty: body.qty, unit_price: body.unit_price }]
  if (rawLines.length === 0) return NextResponse.json({ error: 'at least one line required' }, { status: 400 })

  const rows: Record<string, unknown>[] = []
  for (const [i, l] of rawLines.entries()) {
    const where = rawLines.length > 1 ? ` (line ${i + 1})` : ''
    if (typeof l?.sku_id !== 'string' || !l.sku_id) return NextResponse.json({ error: `sku_id required${where}` }, { status: 400 })
    const qty = Number(l.qty)
    // A buyout only ever adds units to our pool; a mistake is deleted, not negated.
    if (!Number.isInteger(qty) || qty <= 0) return NextResponse.json({ error: `qty must be a positive integer${where}` }, { status: 400 })
    const row: Record<string, unknown> = { supplier_id, sku_id: l.sku_id, bought_at, qty }
    if (l.unit_price !== undefined && l.unit_price !== null && l.unit_price !== '') {
      const p = Number(l.unit_price)
      if (!Number.isFinite(p) || p < 0) return NextResponse.json({ error: `unit_price must be a non-negative number${where}` }, { status: 400 })
      row.unit_price = p
    }
    if (invoice_no !== undefined) row.invoice_no = invoice_no === null ? null : String(invoice_no)
    if (note !== undefined) row.note = note === null ? null : String(note)
    rows.push(row)
  }

  // Same SKU twice on one invoice would read as a duplicate line and the own-pool
  // replay would split it in two — reject instead of silently merging.
  const skuIds = rows.map(r => r.sku_id as string)
  if (new Set(skuIds).size !== skuIds.length) {
    return NextResponse.json({ error: 'the same SKU appears twice — merge the lines' }, { status: 400 })
  }

  const { data, error } = await sbInventory.from('consignment_buyout').insert(rows).select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [], item: data?.[0] ?? null })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)

  if (url.searchParams.get('group')) {
    const supplier_id = url.searchParams.get('supplier_id')
    const bought_at = url.searchParams.get('bought_at')
    if (!supplier_id) return NextResponse.json({ error: 'supplier_id required' }, { status: 400 })
    if (!bought_at || !/^\d{4}-\d{2}-\d{2}$/.test(bought_at)) return NextResponse.json({ error: 'bought_at YYYY-MM-DD required' }, { status: 400 })
    const invoice_no = url.searchParams.get('invoice_no')
    let q = sbInventory.from('consignment_buyout').delete()
      .eq('supplier_id', supplier_id).eq('bought_at', bought_at)
    q = invoice_no === null || invoice_no === '' ? q.is('invoice_no', null) : q.eq('invoice_no', invoice_no)
    const { error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 })
  const { error } = await sbInventory.from('consignment_buyout').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
