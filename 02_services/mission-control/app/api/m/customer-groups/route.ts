import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// POST /api/m/customer-groups — создать группу и записать в неё клиентов.
// Body: { name: string, member_ids: string[] }
// Если member_ids передан — атомарно: создаём группу + проставляем всем members group_id.

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { name, member_ids } = body
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  if (!Array.isArray(member_ids) || member_ids.length === 0) {
    return NextResponse.json({ error: 'member_ids (non-empty array) required' }, { status: 400 })
  }
  if (member_ids.some(id => typeof id !== 'string' || !id)) {
    return NextResponse.json({ error: 'member_ids must contain valid uuids' }, { status: 400 })
  }

  // Создаём группу
  const { data: gRow, error: gErr } = await sbInventory
    .from('b2b_customer_group')
    .insert({ name: name.trim() })
    .select('id, name')
    .single()
  if (gErr || !gRow) return NextResponse.json({ error: gErr?.message ?? 'failed to create group' }, { status: 500 })

  // Записываем members
  const { error: uErr } = await sbInventory
    .from('b2b_customer')
    .update({ group_id: gRow.id, updated_at: new Date().toISOString() })
    .in('id', member_ids)
  if (uErr) {
    // Rollback: удаляем созданную группу (хотя в SET NULL on delete нюансов нет, members при rollback ничего не теряют)
    await sbInventory.from('b2b_customer_group').delete().eq('id', gRow.id)
    return NextResponse.json({ error: uErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: gRow.id, name: gRow.name })
}
