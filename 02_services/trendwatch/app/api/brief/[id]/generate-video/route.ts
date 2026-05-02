import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateVideo } from '@/lib/runway'
import { notifyVideoReady } from '@/lib/barrymore'
import type { VisualPrompt, ConsistencyAnchors } from '@/lib/supabase'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: brief, error } = await supabase
    .from('trend_briefs')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !brief) return NextResponse.json({ error: 'Brief not found' }, { status: 404 })
  if (!brief.visual_prompts?.length) {
    return NextResponse.json({ error: 'No visual prompts — use filming instructions instead' }, { status: 400 })
  }
  if (brief.video_status === 'generating' || brief.video_status === 'assembling') {
    return NextResponse.json({ error: 'Video generation already in progress' }, { status: 409 })
  }

  await supabase.from('trend_briefs')
    .update({ video_status: 'generating', video_error: null })
    .eq('id', id)

  // Fire and forget — client polls /video-status
  generateVideoBackground(id, brief).catch(async (err) => {
    console.error('[generate-video]', err)
    await supabase.from('trend_briefs').update({
      video_status: 'error',
      video_error: String(err?.message ?? err).slice(0, 1000),
    }).eq('id', id)
  })

  return NextResponse.json({ ok: true, status: 'generating' })
}

async function generateVideoBackground(briefId: string, brief: Record<string, unknown>) {
  const prompts  = brief.visual_prompts as VisualPrompt[]
  const anchors  = (brief.consistency_anchors as ConsistencyAnchors | null) ?? null
  const textCopy = (brief.text_overlay_copy as string[] | null) ?? []

  await supabase.from('trend_briefs').update({ video_status: 'assembling' }).eq('id', briefId)

  const videoUrl = await generateVideo(briefId, prompts, textCopy, anchors)

  await supabase.from('trend_briefs').update({
    video_url: videoUrl,
    video_status: 'ready',
  }).eq('id', briefId)

  await notifyVideoReady(briefId, videoUrl)
}
