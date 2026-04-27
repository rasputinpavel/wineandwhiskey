import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { extractAndUploadFrames, getFrameBase64 } from '@/lib/ffmpeg'
import { analyzeReelFrames } from '@/lib/claude'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: reel, error: reelErr } = await supabase
    .from('trend_reels')
    .select('*, trend_accounts(username)')
    .eq('id', id)
    .single()

  if (reelErr || !reel) return NextResponse.json({ error: 'Reel not found' }, { status: 404 })
  if (!reel.video_url) return NextResponse.json({ error: 'No video URL available' }, { status: 400 })

  await supabase.from('trend_reels').update({ status: 'analyzing' }).eq('id', id)

  try {
    const frames = await extractAndUploadFrames(id, reel.video_url, reel.duration_s ?? undefined)

    await supabase.from('trend_frames').insert(
      frames.map(f => ({ reel_id: id, timestamp_s: f.timestamp_s, storage_path: f.storage_path }))
    )

    const framesWithBase64 = await Promise.all(
      frames.map(async f => ({
        timestamp_s: f.timestamp_s,
        base64: await getFrameBase64(f.storage_path),
      }))
    )

    const analysis = await analyzeReelFrames({
      frames: framesWithBase64,
      caption: reel.caption,
      views: reel.views_count,
      likes: reel.likes_count,
      duration: reel.duration_s,
    })

    await supabase.from('trend_analysis').upsert({
      reel_id: id,
      ...analysis,
    })

    await supabase.from('trend_reels').update({ status: 'analyzed' }).eq('id', id)

    return NextResponse.json({ ok: true, frames: frames.length, analysis })
  } catch (err) {
    await supabase.from('trend_reels').update({ status: 'new' }).eq('id', id)
    console.error('[analyze]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
