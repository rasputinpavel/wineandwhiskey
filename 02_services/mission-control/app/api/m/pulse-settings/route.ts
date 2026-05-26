import { NextResponse } from 'next/server'
import { sbInventory } from '@/lib/supabase'

// Single-row settings for Finance Pulse — currently just the cost buffer %.
//   GET    → fetch current settings
//   PATCH  { fixed_buffer_pct } → update

export async function GET() {
  const { data, error } = await sbInventory.from('pulse_settings').select('*').eq('id', 1).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { fixed_buffer_pct } = body
  if (typeof fixed_buffer_pct !== 'number' || !Number.isFinite(fixed_buffer_pct) || fixed_buffer_pct < 0) {
    return NextResponse.json({ error: 'fixed_buffer_pct must be non-negative number' }, { status: 400 })
  }
  const { error } = await sbInventory
    .from('pulse_settings')
    .upsert({ id: 1, fixed_buffer_pct, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
