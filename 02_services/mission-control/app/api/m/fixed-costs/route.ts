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
  const { category, amount_thb, notes, sort_order, active } = body

  if (typeof category !== 'string' || !category.trim()) {
    return NextResponse.json({ error: 'category (non-empty string) required' }, { status: 400 })
  }
  if (typeof amount_thb !== 'number' || !Number.isFinite(amount_thb) || amount_thb < 0) {
    return NextResponse.json({ error: 'amount_thb (non-negative number) required' }, { status: 400 })
  }

  const row: Record<string, unknown> = { category: category.trim(), amount_thb }
  if (notes !== undefined)      row.notes      = notes === null ? null : String(notes)
  if (sort_order !== undefined) row.sort_order = Math.max(0, Math.floor(Number(sort_order) || 100))
  if (active !== undefined)     row.active     = !!active

  const { data, error } = await sbInventory.from('fixed_cost').insert(row).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { id, category, amount_thb, notes, sort_order, active } = body
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
  if (amount_thb !== undefined) {
    if (typeof amount_thb !== 'number' || !Number.isFinite(amount_thb) || amount_thb < 0) {
      return NextResponse.json({ error: 'amount_thb must be non-negative number' }, { status: 400 })
    }
    patch.amount_thb = amount_thb
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
