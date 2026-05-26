import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// Upsert a single editable cell (opening_stock, closing_stock, tastings,
// notes) for one (supplier, sku, period) tuple.
//
//   PATCH  { supplier_id, sku_id, period, field, value }
//          field ∈ { opening_stock, closing_stock, tastings, notes }
//          value: number | null for stocks/tastings; string | null for notes

const FIELDS = new Set(['opening_stock', 'closing_stock', 'tastings', 'notes'])

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { supplier_id, sku_id, period, field, value } = body
  if (typeof supplier_id !== 'string' || !supplier_id) return NextResponse.json({ error: 'supplier_id required' }, { status: 400 })
  if (typeof sku_id !== 'string' || !sku_id) return NextResponse.json({ error: 'sku_id required' }, { status: 400 })
  if (typeof period !== 'string' || !/^\d{4}-\d{2}$/.test(period)) return NextResponse.json({ error: 'period YYYY-MM required' }, { status: 400 })
  if (!FIELDS.has(field)) return NextResponse.json({ error: `field must be one of ${[...FIELDS].join(',')}` }, { status: 400 })

  let normalized: number | string | null
  if (field === 'notes') {
    normalized = value == null ? null : String(value)
  } else {
    if (value === null || value === '') {
      normalized = null
    } else {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: `${field} must be non-negative integer` }, { status: 400 })
      normalized = Math.round(n)
    }
    if (field === 'tastings' && normalized === null) normalized = 0
  }

  const row: Record<string, unknown> = { supplier_id, sku_id, period, [field]: normalized, updated_at: new Date().toISOString() }
  const { error } = await sbInventory.from('consignment_report_cell').upsert(row, { onConflict: 'supplier_id,sku_id,period' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
