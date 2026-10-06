import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// PATCH /api/m/invoices — ручные пометки на одном инвойсе.
// Body: { id: string (uuid), excluded?: boolean, consignment_exempt?: boolean }
//   excluded           — скрыть кривой инвойс из таблицы
//   consignment_exempt — это продажа ПОВЕРХ полки, а не отчёт о продажах с неё:
//                        v_consignment_balance такой инвойс не вычитает (048)

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { id, excluded, consignment_exempt } = body
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'id (uuid) required' }, { status: 400 })
  }

  const patch: Record<string, boolean> = {}
  if (typeof excluded === 'boolean') patch.excluded = excluded
  if (typeof consignment_exempt === 'boolean') patch.consignment_exempt = consignment_exempt
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'excluded or consignment_exempt (boolean) required' }, { status: 400 })
  }

  const { error } = await sbInventory
    .from('flowaccount_invoice')
    .update(patch)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
