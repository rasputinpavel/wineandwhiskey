import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// POST { days, scope: 'unset' | 'all' }

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body.days !== 'number' || body.days < 0) {
    return NextResponse.json({ error: 'days (non-negative number) required' }, { status: 400 })
  }
  const scope = body.scope === 'all' ? 'all' : 'unset'

  let q = sbInventory
    .from('supplier')
    .update({ payment_terms_days: body.days, updated_at: new Date().toISOString() })
  if (scope === 'unset') q = q.eq('payment_terms_days', 0)

  const { data, error } = await q.select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ updated: data?.length ?? 0 })
}
