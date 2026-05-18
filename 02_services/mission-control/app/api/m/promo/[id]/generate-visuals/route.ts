// POST /api/m/promo/<id>/generate-visuals
//
// Phase 3: render all 7 formats (IG post/story, TG post, A2/A3 PDFs,
// web banner desktop+mobile) via Puppeteer, upload to Supabase Storage
// bucket `promo`, write the object-key map into `campaign.assets`.
//
// Long-running — Puppeteer cold-start (~3s) + 7 renders (~4-8s each) +
// uploads = 30-60s. Caller (the button) shows a spinner; Railway has no
// default request timeout, so this just blocks until done.

import { NextResponse } from 'next/server'
import { sbPromo } from '@/lib/supabase'
import { renderPromoVisuals } from '@/lib/promo/render'
import { uploadAssets } from '@/lib/promo/storage'
import type { PromoCampaign } from '@/lib/promo/types'

// We need a longer timeout than the Next.js default for this route.
export const maxDuration = 300  // seconds — Railway-friendly; Vercel hobby would 504

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: campaign, error: readErr } = await sbPromo
    .from('campaign').select('*').eq('id', id).single()
  if (readErr || !campaign) {
    return NextResponse.json({ error: readErr?.message ?? 'not found' }, { status: 404 })
  }
  const c = campaign as PromoCampaign
  if (!c.headline) {
    return NextResponse.json(
      { error: 'Generate copy first — visuals need headline/subhead/mode/composition' },
      { status: 400 },
    )
  }

  // Flip to 'generating' so the UI can show progress and a second click is
  // discouraged. We don't gate on it server-side — a user who really wants to
  // re-fire can clear status manually.
  await sbPromo.from('campaign').update({ status: 'generating' }).eq('id', id)

  try {
    const assets = await renderPromoVisuals(c)
    const objectPaths = await uploadAssets(c.slug, assets)

    const { data: updated, error: writeErr } = await sbPromo
      .from('campaign')
      .update({
        assets: objectPaths,
        generated_at: new Date().toISOString(),
        // Drop back to 'draft' so the user reviews then flips to 'ready'.
        status: 'draft',
      })
      .eq('id', id)
      .select()
      .single()

    if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 })
    return NextResponse.json({ campaign: updated })
  } catch (e) {
    // Restore status on failure so the UI doesn't get stuck.
    await sbPromo.from('campaign').update({ status: c.status }).eq('id', id)
    const msg = friendlyError((e as Error).message)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Strip the Google API JSON dumps to a human-readable message.
function friendlyError(raw: string): string {
  // Try to extract a JSON error blob if Google's SDK serialized it into the message.
  const m = raw.match(/"message"\s*:\s*"([^"]+)"/)
  const inner = m?.[1] ?? raw
  // Status hint.
  const status = raw.match(/\b(503|429|500|RESOURCE_EXHAUSTED|UNAVAILABLE)\b/)?.[1]
  if (status === '503' || /UNAVAILABLE|high demand|overloaded/i.test(inner)) {
    return 'Gemini is overloaded right now — try again in 30–60 seconds.'
  }
  if (status === '429' || /RESOURCE_EXHAUSTED|quota/i.test(inner)) {
    return 'Gemini quota exceeded — check billing or wait for daily reset.'
  }
  return inner.slice(0, 240)
}
