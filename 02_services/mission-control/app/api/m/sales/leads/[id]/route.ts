// PATCH /api/m/sales/leads/[id]
// Update any subset of: stage, assignee, notes, next_action_at, business_kind,
// last_contact_at, customer_id. Stage transitions go through queries.transitionStage
// so first_taken_at / last_contact_at side-effects happen consistently.

import { NextResponse } from 'next/server'
import { sbSales } from '@/lib/supabase'
import { transitionStage, logActivity } from '@/lib/sales/queries'
import { LEAD_STAGES, type LeadStage } from '@/lib/sales/types'
import { BUSINESS_KINDS, type BusinessKind } from '@/lib/sales/config'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  // Stage transitions have side-effects — delegate.
  if (typeof body.stage === 'string') {
    if (!(LEAD_STAGES as readonly string[]).includes(body.stage)) {
      return NextResponse.json({ error: 'invalid stage' }, { status: 400 })
    }
    try { await transitionStage(id, body.stage as LeadStage) }
    catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 500 }) }
  }

  // Remaining fields — straight assignment.
  const patch: Record<string, unknown> = {}
  if (typeof body.assignee === 'string' || body.assignee === null) patch.assignee = body.assignee
  if (typeof body.notes === 'string' || body.notes === null)       patch.notes = body.notes
  if (typeof body.next_action_at === 'string' || body.next_action_at === null) patch.next_action_at = body.next_action_at
  if (typeof body.last_contact_at === 'string' || body.last_contact_at === null) patch.last_contact_at = body.last_contact_at
  if (typeof body.customer_id === 'string' || body.customer_id === null) patch.customer_id = body.customer_id
  if (typeof body.business_kind === 'string') {
    if (!(BUSINESS_KINDS as readonly string[]).includes(body.business_kind)) {
      return NextResponse.json({ error: 'invalid business_kind' }, { status: 400 })
    }
    patch.business_kind = body.business_kind as BusinessKind
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await sbSales.from('lead').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data, error } = await sbSales.from('lead').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ lead: data })
}

// DELETE /api/m/sales/leads/[id] — used for cleaning up bad imports.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await sbSales.from('lead').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// POST /api/m/sales/leads/[id]/notes — actually lives at /notes/route.ts below;
// keeping this file PATCH-only.
void logActivity
