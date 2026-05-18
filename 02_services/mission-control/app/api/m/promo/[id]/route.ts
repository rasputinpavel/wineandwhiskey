// PATCH /api/m/promo/<id> — update a promo. For Phase 1 we only allow editing
// brief fields and toggling status between draft / ready manually. Later phases
// will own copy / visual_mode / composition / assets via the generate endpoints.
//
// DELETE /api/m/promo/<id> — hard delete. Brief is cheap; if you regret it,
// just re-create.

import { NextResponse } from 'next/server'
import { sbPromo } from '@/lib/supabase'
import { PROMO_MOODS, PROMO_STATUSES, slugify, type PromoMood, type PromoStatus } from '@/lib/promo/types'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}

  if (typeof body.theme    === 'string') patch.theme    = body.theme.trim()
  if (typeof body.mechanic === 'string') patch.mechanic = body.mechanic.trim()

  if (typeof body.starts_on === 'string') {
    if (!ISO_DATE.test(body.starts_on)) return NextResponse.json({ error: 'starts_on must be YYYY-MM-DD' }, { status: 400 })
    patch.starts_on = body.starts_on
  }
  if (typeof body.ends_on === 'string') {
    if (!ISO_DATE.test(body.ends_on)) return NextResponse.json({ error: 'ends_on must be YYYY-MM-DD' }, { status: 400 })
    patch.ends_on = body.ends_on
  }
  if (patch.starts_on && patch.ends_on && (patch.ends_on as string) < (patch.starts_on as string)) {
    return NextResponse.json({ error: 'ends_on must be ≥ starts_on' }, { status: 400 })
  }

  if (typeof body.mood === 'string') {
    if (!(PROMO_MOODS as readonly string[]).includes(body.mood)) {
      return NextResponse.json({ error: `mood must be one of ${PROMO_MOODS.join(', ')}` }, { status: 400 })
    }
    patch.mood = body.mood as PromoMood
  }

  if (Array.isArray(body.sku_slugs)) {
    const sk = body.sku_slugs.filter((s): s is string => typeof s === 'string' && s.length > 0)
    if (sk.length === 0) return NextResponse.json({ error: 'at least one SKU is required' }, { status: 400 })
    patch.sku_slugs = sk
  }

  if (typeof body.status === 'string') {
    if (!(PROMO_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: `status must be one of ${PROMO_STATUSES.join(', ')}` }, { status: 400 })
    }
    patch.status = body.status as PromoStatus
  }

  // Reslug if theme or start date changed.
  if (typeof patch.theme === 'string' || typeof patch.starts_on === 'string') {
    const { data: current, error: readErr } = await sbPromo
      .from('campaign').select('theme, starts_on').eq('id', id).single()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    const theme    = (patch.theme as string)    ?? current.theme
    const startsOn = (patch.starts_on as string) ?? current.starts_on
    patch.slug = slugify(theme, startsOn)
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const { data, error } = await sbPromo
    .from('campaign').update(patch).eq('id', id).select().single()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Another promo with this theme+date already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ campaign: data })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await sbPromo.from('campaign').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
