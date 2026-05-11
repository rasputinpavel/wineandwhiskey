import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// PATCH /api/m/customer-groups/[id] — переименовать группу.
// Body: { name: string }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { name } = body
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  const { error } = await sbInventory
    .from('b2b_customer_group')
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/m/customer-groups/[id] — удалить группу. Members получают group_id = null
// благодаря ON DELETE SET NULL в FK constraint.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await sbInventory
    .from('b2b_customer_group')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
