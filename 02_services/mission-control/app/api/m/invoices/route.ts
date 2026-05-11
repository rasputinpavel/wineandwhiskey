import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// PATCH /api/m/invoices — toggle excluded на одном инвойсе.
// Body: { id: string (uuid), excluded: boolean }

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { id, excluded } = body
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'id (uuid) required' }, { status: 400 })
  }
  if (typeof excluded !== 'boolean') {
    return NextResponse.json({ error: 'excluded (boolean) required' }, { status: 400 })
  }

  const { error } = await sbInventory
    .from('flowaccount_invoice')
    .update({ excluded })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
