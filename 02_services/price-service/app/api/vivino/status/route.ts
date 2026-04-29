import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const price_list_id = req.nextUrl.searchParams.get('price_list_id')
  if (!price_list_id) return NextResponse.json({ error: 'price_list_id required' }, { status: 400 })

  // Counts on wine_items — these are the source of truth for the UI.
  const [totalRes, enrichedRes, failedRes] = await Promise.all([
    supabase.from('wine_items').select('id', { count: 'exact', head: true }).eq('price_list_id', price_list_id).not('name', 'is', null),
    supabase.from('wine_items').select('id', { count: 'exact', head: true }).eq('price_list_id', price_list_id).not('vivino_enriched_at', 'is', null),
    supabase.from('wine_items').select('id', { count: 'exact', head: true }).eq('price_list_id', price_list_id).not('vivino_failed_at', 'is', null),
  ])

  // Latest job (if any) so the UI can show running/paused/failed states.
  const { data: job } = await supabase
    .from('vivino_jobs')
    .select('id, state, mode, total, processed, enriched, not_found, cache_hits, apify_runs, apify_items, last_error, started_at, finished_at, heartbeat_at')
    .eq('price_list_id', price_list_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    total: totalRes.count ?? 0,
    enriched: enrichedRes.count ?? 0,
    failed: failedRes.count ?? 0,
    job: job ?? null,
  })
}
