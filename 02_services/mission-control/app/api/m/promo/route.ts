// POST /api/m/promo — create a new draft promo campaign.
//
// All fields are required except notes (there are no notes — keep brief
// minimal). The slug is derived from theme + starts_on so two promos on the
// same day would collide; that's intentional, we want at most one per week.

import { NextResponse } from 'next/server'
import { sbPromo } from '@/lib/supabase'
import { PROMO_MOODS, slugify, type PromoMood } from '@/lib/promo/types'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const theme    = typeof body.theme    === 'string' ? body.theme.trim()    : ''
  const mechanic = typeof body.mechanic === 'string' ? body.mechanic.trim() : ''
  const startsOn = typeof body.starts_on === 'string' ? body.starts_on : ''
  const endsOn   = typeof body.ends_on   === 'string' ? body.ends_on   : ''

  if (!theme)    return NextResponse.json({ error: 'theme required' }, { status: 400 })
  if (!mechanic) return NextResponse.json({ error: 'mechanic required' }, { status: 400 })
  if (!ISO_DATE.test(startsOn)) return NextResponse.json({ error: 'starts_on must be YYYY-MM-DD' }, { status: 400 })
  if (!ISO_DATE.test(endsOn))   return NextResponse.json({ error: 'ends_on must be YYYY-MM-DD' }, { status: 400 })
  if (endsOn < startsOn)        return NextResponse.json({ error: 'ends_on must be ≥ starts_on' }, { status: 400 })

  const mood: PromoMood =
    typeof body.mood === 'string' && (PROMO_MOODS as readonly string[]).includes(body.mood)
      ? body.mood as PromoMood
      : 'direct'

  const skuSlugs = Array.isArray(body.sku_slugs)
    ? body.sku_slugs.filter((s): s is string => typeof s === 'string' && s.length > 0)
    : []
  if (skuSlugs.length === 0) {
    return NextResponse.json({ error: 'at least one SKU is required' }, { status: 400 })
  }

  const row = {
    slug: slugify(theme, startsOn),
    theme,
    mechanic,
    starts_on: startsOn,
    ends_on:   endsOn,
    mood,
    sku_slugs: skuSlugs,
  }

  const { data, error } = await sbPromo.from('campaign').insert(row).select().single()
  if (error) {
    // Most likely cause: duplicate slug (a promo already exists for this theme+date).
    if (error.code === '23505') {
      return NextResponse.json({ error: `A promo with slug "${row.slug}" already exists` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ campaign: data })
}
