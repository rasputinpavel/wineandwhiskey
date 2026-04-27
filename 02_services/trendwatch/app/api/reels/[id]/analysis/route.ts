import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabase
    .from('trend_analysis')
    .select('*')
    .eq('reel_id', id)
    .single()
  if (error) return NextResponse.json(null, { status: 404 })
  return NextResponse.json(data)
}
