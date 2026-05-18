// POST /api/m/promo/<id>/generate-copy
//
// One-shot: load brief → call Anthropic with cached design-system prefix →
// write headline / subhead / captions / visual_mode / composition back to DB.
// Does not change status — user reviews then flips draft → ready manually.

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { sbPromo } from '@/lib/supabase'
import { generatePromoCopy } from '@/lib/promo/copy'
import type { PromoCampaign } from '@/lib/promo/types'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: campaign, error: readErr } = await sbPromo
    .from('campaign').select('*').eq('id', id).single()
  if (readErr || !campaign) {
    return NextResponse.json({ error: readErr?.message ?? 'not found' }, { status: 404 })
  }

  try {
    const copy = await generatePromoCopy(campaign as PromoCampaign)

    const { data: updated, error: writeErr } = await sbPromo
      .from('campaign')
      .update({
        headline:    copy.headline,
        subhead:     copy.subhead,
        caption_ig:  copy.caption_ig,
        caption_tg:  copy.caption_tg,
        visual_mode: copy.visual_mode,
        composition: copy.composition,
        nbp_prompt:  copy.nbp_prompt,
      })
      .eq('id', id)
      .select()
      .single()

    if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 })
    return NextResponse.json({ campaign: updated })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY missing or invalid — set it in Railway env vars' },
        { status: 500 },
      )
    }
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: 'Rate limited by Anthropic — try again in a minute' },
        { status: 429 },
      )
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Anthropic ${e.status}: ${e.message}` },
        { status: 502 },
      )
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
