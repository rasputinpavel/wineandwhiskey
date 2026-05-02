import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabase
    .from('trend_analysis')
    .select('*')
    .eq('reel_id', id)
    .maybeSingle()
  if (error) {
    console.error('[analysis GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)  // null if no row, full record if exists
}
