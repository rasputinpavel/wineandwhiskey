// POST /api/m/sales/leads
// Create a lead manually (not via Apify scrape). Not every prospect comes from
// Google Maps — referrals, events, walk-ins all start life here.
//
// Stage defaults to 'lead'; if the caller picks a later stage, we set
// first_taken_at (and last_contact_at for contact-stages) directly so the
// pipeline timers are coherent without an extra PATCH.

import { NextResponse } from 'next/server'
import { sbSales } from '@/lib/supabase'
import { logActivity } from '@/lib/sales/queries'
import { LEAD_STAGES, ACTIVE_PIPELINE_STAGES, type LeadStage } from '@/lib/sales/types'
import { BUSINESS_KINDS, type BusinessKind } from '@/lib/sales/config'

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  // name is the only hard requirement.
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const business_kind: BusinessKind =
    typeof body.business_kind === 'string' && (BUSINESS_KINDS as readonly string[]).includes(body.business_kind)
      ? body.business_kind as BusinessKind
      : 'restaurant'

  const stage: LeadStage =
    typeof body.stage === 'string' && (LEAD_STAGES as readonly string[]).includes(body.stage)
      ? body.stage as LeadStage
      : 'lead'

  const now = new Date().toISOString()
  const row: Record<string, unknown> = {
    name,
    business_kind,
    stage,
    district:        typeof body.district === 'string' && body.district ? body.district : null,
    address:         typeof body.address === 'string' && body.address ? body.address : null,
    phone:           typeof body.phone === 'string' && body.phone ? body.phone : null,
    website:         typeof body.website === 'string' && body.website ? body.website : null,
    notes:           typeof body.notes === 'string' && body.notes ? body.notes : null,
    assignee:        typeof body.assignee === 'string' && body.assignee ? body.assignee : null,
    first_taken_at:  stage !== 'lead' ? now : null,
    last_contact_at: ACTIVE_PIPELINE_STAGES.includes(stage) && stage !== 'in_work' ? now : null,
  }

  const { data, error } = await sbSales.from('lead').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit trail — distinguish manually-created leads from Apify imports.
  await logActivity(data.id, 'note', 'Lead created manually', { source: 'manual' }).catch(() => {})

  return NextResponse.json({ lead: data })
}
