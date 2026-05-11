// POST /api/m/sales/leads/[id]/contact
// Body: { kind: 'call'|'meeting'|'whatsapp'|'email'|'note', note?: string }
// Bumps last_contact_at and writes a lead_activity row. The 5-day-stale rule
// uses last_contact_at, so this is the canonical "touch the lead" endpoint.

import { NextResponse } from 'next/server'
import { sbSales } from '@/lib/supabase'
import { logActivity } from '@/lib/sales/queries'

const VALID_KINDS = ['call', 'meeting', 'whatsapp', 'email', 'note'] as const
type Kind = (typeof VALID_KINDS)[number]

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { kind?: string; note?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const kind = body.kind ?? 'note'
  if (!(VALID_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note : null

  // 'note' is a journal entry; doesn't count as outbound contact. Everything
  // else bumps the clock.
  const bumpClock = kind !== 'note'
  if (bumpClock) {
    const { error } = await sbSales
      .from('lead')
      .update({ last_contact_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  try { await logActivity(id, kind as Kind, note) }
  catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 500 }) }

  return NextResponse.json({ ok: true })
}
