import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('trend_our_reels')
    .select('*, trend_reels(views_count, thumbnail_url, url), trend_briefs(hook_options)')
    .order('published_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { brief_id, reel_id, instagram_url, published_at, notes } = body

  const { data, error } = await supabase
    .from('trend_our_reels')
    .insert({ brief_id, reel_id, instagram_url, published_at, notes })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (reel_id) {
    await supabase.from('trend_reels').update({ status: 'published' }).eq('id', reel_id)
  }

  return NextResponse.json(data)
}
