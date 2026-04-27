import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { views_7d, views_14d, views_30d, likes_count, followers_gained, notes } = await req.json()

  const { data, error } = await supabase
    .from('trend_our_reels')
    .update({
      views_7d,
      views_14d,
      views_30d,
      likes_count,
      followers_gained,
      notes,
      last_tracked_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
