import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// Close / reopen a consignment supplier's monthly report.
//
//   POST   { supplier_id, period, closings: [{ sku_id, closing }] }
//          → persist each SKU's closing_stock (so it carries forward as next
//            month's opening) and mark the period closed.
//   DELETE ?supplier_id=&period=  → reopen (closing values are kept).

const PERIOD_TABLE = 'consignment_report_period'
const CELL_TABLE = 'consignment_report_cell'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { supplier_id, period, closings } = body
  if (typeof supplier_id !== 'string' || !supplier_id) return NextResponse.json({ error: 'supplier_id required' }, { status: 400 })
  if (typeof period !== 'string' || !/^\d{4}-\d{2}$/.test(period)) return NextResponse.json({ error: 'period YYYY-MM required' }, { status: 400 })
  if (!Array.isArray(closings)) return NextResponse.json({ error: 'closings array required' }, { status: 400 })

  const now = new Date().toISOString()
  const rows = closings
    .filter((c: any) => c && typeof c.sku_id === 'string' && Number.isFinite(Number(c.closing)))
    .map((c: any) => ({ supplier_id, sku_id: c.sku_id, period, closing_stock: Math.round(Number(c.closing)), updated_at: now }))

  // Persist closing_stock per SKU (only this column is touched on conflict).
  if (rows.length) {
    const { error } = await sbInventory.from(CELL_TABLE).upsert(rows, { onConflict: 'supplier_id,sku_id,period' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { error: pErr } = await sbInventory
    .from(PERIOD_TABLE).upsert({ supplier_id, period, closed_at: now }, { onConflict: 'supplier_id,period' })
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  return NextResponse.json({ ok: true, saved: rows.length })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const supplier_id = url.searchParams.get('supplier_id')
  const period = url.searchParams.get('period')
  if (!supplier_id || !period) return NextResponse.json({ error: 'supplier_id and period required' }, { status: 400 })
  const { error } = await sbInventory.from(PERIOD_TABLE).delete().eq('supplier_id', supplier_id).eq('period', period)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
