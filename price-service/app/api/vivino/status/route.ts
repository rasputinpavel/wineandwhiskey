import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const price_list_id = req.nextUrl.searchParams.get('price_list_id')
  if (!price_list_id) return NextResponse.json({ error: 'price_list_id required' }, { status: 400 })

  const [totalRes, enrichedRes] = await Promise.all([
    supabase.from('wine_items').select('id', { count: 'exact', head: true }).eq('price_list_id', price_list_id).not('name', 'is', null),
    supabase.from('wine_items').select('id', { count: 'exact', head: true }).eq('price_list_id', price_list_id).not('vivino_enriched_at', 'is', null),
  ])

  return NextResponse.json({
    total: totalRes.count ?? 0,
    enriched: enrichedRes.count ?? 0,
  })
}
