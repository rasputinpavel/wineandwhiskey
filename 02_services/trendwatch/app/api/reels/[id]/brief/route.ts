import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateBrief } from '@/lib/claude'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: reel, error: reelErr } = await supabase
    .from('trend_reels')
    .select('*, trend_accounts(username)')
    .eq('id', id)
    .single()

  if (reelErr || !reel) return NextResponse.json({ error: 'Reel not found' }, { status: 404 })

  const { data: analysis, error: analysisErr } = await supabase
    .from('trend_analysis')
    .select('*')
    .eq('reel_id', id)
    .single()

  if (analysisErr || !analysis) {
    return NextResponse.json({ error: 'Analyze the reel first' }, { status: 400 })
  }

  try {
    const brief = await generateBrief({
      analysis,
      caption: reel.caption,
      views: reel.views_count,
      accountUsername: reel.trend_accounts?.username ?? 'unknown',
    })

    const { data: saved, error: saveErr } = await supabase
      .from('trend_briefs')
      .upsert({ reel_id: id, analysis_id: analysis.id, ...brief })
      .select()
      .single()

    if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

    await supabase.from('trend_reels').update({ status: 'briefed' }).eq('id', id)

    return NextResponse.json(saved)
  } catch (err) {
    console.error('[brief]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabase
    .from('trend_briefs')
    .select('*')
    .eq('reel_id', id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}
