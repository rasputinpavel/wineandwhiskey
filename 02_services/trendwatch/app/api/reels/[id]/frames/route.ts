import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getPublicFrameUrl } from '@/lib/ffmpeg'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabase
    .from('trend_frames')
    .select('*')
    .eq('reel_id', id)
    .order('timestamp_s')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const framesWithUrls = await Promise.all(
    (data ?? []).map(async f => ({
      ...f,
      url: await getPublicFrameUrl(f.storage_path),
    }))
  )

  return NextResponse.json(framesWithUrls)
}
