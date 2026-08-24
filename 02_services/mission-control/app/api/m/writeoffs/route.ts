import { NextResponse } from 'next/server'
import { sbPublic } from '@/lib/supabase'

// GET /api/m/writeoffs?status=pending|all — list write-offs.
export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get('status') ?? 'pending'
  let q = sbPublic
    .from('stock_writeoffs')
    .select('id, variant_id, item_name, qty, taken_date, taken_by, status, closed_at, closed_by')
    .order('taken_date', { ascending: true })
  if (status !== 'all') q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rows: data ?? [] })
}

// POST /api/m/writeoffs { id, closed_by? } — mark a write-off done.
export async function POST(req: Request) {
  const body = await req.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await sbPublic
    .from('stock_writeoffs')
    .update({
      status: 'done',
      closed_at: new Date().toISOString(),
      closed_by: typeof body.closed_by === 'string' ? body.closed_by : 'portal',
    })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
