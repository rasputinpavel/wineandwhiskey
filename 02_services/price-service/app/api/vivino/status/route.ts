import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { runJob } from '@/lib/vivino/enrich'

// Heartbeat older than this = the Node process that owned the job is dead
// (typical cause: Railway redeploy mid-run). The UI poll passes through here
// every 4s; auto-reclaim keeps stranded jobs moving without manual SQL.
const STALE_HEARTBEAT_MS = 90_000

export async function GET(req: NextRequest) {
  const price_list_id = req.nextUrl.searchParams.get('price_list_id')
  if (!price_list_id) return NextResponse.json({ error: 'price_list_id required' }, { status: 400 })

  const [totalRes, enrichedRes, failedRes] = await Promise.all([
    supabase.from('wine_items').select('id', { count: 'exact', head: true }).eq('price_list_id', price_list_id).not('name', 'is', null),
    supabase.from('wine_items').select('id', { count: 'exact', head: true }).eq('price_list_id', price_list_id).not('vivino_enriched_at', 'is', null),
    supabase.from('wine_items').select('id', { count: 'exact', head: true }).eq('price_list_id', price_list_id).not('vivino_failed_at', 'is', null),
  ])

  const { data: job } = await supabase
    .from('vivino_jobs')
    .select('id, state, mode, total, processed, enriched, not_found, cache_hits, apify_runs, apify_items, last_error, started_at, finished_at, heartbeat_at')
    .eq('price_list_id', price_list_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Auto-reclaim: if the latest job is queued or has a stale heartbeat, kick
  // runJob in this process. RUNNING_JOBS dedups so an already-active loop
  // is a no-op.
  if (job && (job.state === 'queued' || job.state === 'running')) {
    const hbAge = job.heartbeat_at ? Date.now() - new Date(job.heartbeat_at).getTime() : Infinity
    if (job.state === 'queued' || hbAge > STALE_HEARTBEAT_MS) {
      runJob(job.id)
    }
  }

  return NextResponse.json({
    total: totalRes.count ?? 0,
    enriched: enrichedRes.count ?? 0,
    failed: failedRes.count ?? 0,
    job: job ?? null,
  })
}
