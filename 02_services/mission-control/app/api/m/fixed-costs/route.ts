import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// CRUD for inventory.fixed_cost — backs the Finance Pulse Settings page.
//
//   GET    /api/m/fixed-costs         → list (sort_order asc)
//   POST   /api/m/fixed-costs         { category, amount_thb, notes?, sort_order?, active? } → create
//   PATCH  /api/m/fixed-costs         { id, ...fields } → update
//   DELETE /api/m/fixed-costs?id=...  → delete

export async function GET() {
  const { data, error } = await sbInventory
    .from('fixed_cost')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('category', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { category, amount_thb, percent_revenue, notes, sort_order, active } = body

  if (typeof category !== 'string' || !category.trim()) {
    return NextResponse.json({ error: 'category (non-empty string) required' }, { status: 400 })
  }
  const hasAmount = typeof amount_thb === 'number' && Number.isFinite(amount_thb) && amount_thb >= 0
  const hasPct    = typeof percent_revenue === 'number' && Number.isFinite(percent_revenue) && percent_revenue >= 0 && percent_revenue <= 100
  if (!hasAmount && !hasPct) {
    return NextResponse.json({ error: 'amount_thb (≥0) or percent_revenue (0..100) required' }, { status: 400 })
  }

  const row: Record<string, unknown> = {
    category: category.trim(),
    amount_thb:      hasPct ? null     : amount_thb,
    percent_revenue: hasPct ? percent_revenue : null,
  }
  if (notes !== undefined)      row.notes      = notes === null ? null : String(notes)
  if (sort_order !== undefined) row.sort_order = Math.max(0, Math.floor(Number(sort_order) || 100))
  if (active !== undefined)     row.active     = !!active

  const { data, error } = await sbInventory.from('fixed_cost').insert(row).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { id, category, amount_thb, percent_revenue, notes, sort_order, active } = body
  if (typeof id !== 'string') {
    return NextResponse.json({ error: 'id (string) required' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (category !== undefined) {
    if (typeof category !== 'string' || !category.trim()) {
      return NextResponse.json({ error: 'category must be non-empty string' }, { status: 400 })
    }
    patch.category = category.trim()
  }
  // Switching to fixed THB: amount_thb set, percent_revenue cleared.
  if (amount_thb !== undefined) {
    if (amount_thb === null) {
      patch.amount_thb = null
    } else {
      if (typeof amount_thb !== 'number' || !Number.isFinite(amount_thb) || amount_thb < 0) {
        return NextResponse.json({ error: 'amount_thb must be non-negative number or null' }, { status: 400 })
      }
      patch.amount_thb = amount_thb
      patch.percent_revenue = null
    }
  }
  // Switching to pct-of-revenue: percent_revenue set, amount_thb cleared.
  if (percent_revenue !== undefined) {
    if (percent_revenue === null) {
      patch.percent_revenue = null
    } else {
      if (typeof percent_revenue !== 'number' || !Number.isFinite(percent_revenue) || percent_revenue < 0 || percent_revenue > 100) {
        return NextResponse.json({ error: 'percent_revenue must be 0..100 or null' }, { status: 400 })
      }
      patch.percent_revenue = percent_revenue
      patch.amount_thb = null
    }
  }
  if (notes !== undefined)      patch.notes      = notes === null ? null : String(notes)
  if (sort_order !== undefined) patch.sort_order = Math.max(0, Math.floor(Number(sort_order) || 100))
  if (active !== undefined)     patch.active     = !!active

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  const { error } = await sbInventory.from('fixed_cost').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 })

  const { error } = await sbInventory.from('fixed_cost').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
