import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createJob, runJob, type JobMode } from '@/lib/vivino/enrich'
import { apifyConfigured } from '@/lib/vivino/apify'

const ALLOWED_MODES: JobMode[] = ['missing', 'failed', 'all']

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const price_list_id = body.price_list_id as string | undefined
  // Backwards compat: { force: true } from old UI maps to mode='all'.
  const rawMode = (body.mode as JobMode | undefined) ?? (body.force ? 'all' : 'missing')
  const mode: JobMode = ALLOWED_MODES.includes(rawMode) ? rawMode : 'missing'

  if (!price_list_id) return NextResponse.json({ error: 'price_list_id required' }, { status: 400 })
  if (!apifyConfigured()) return NextResponse.json({ error: 'APIFY_TOKEN not configured' }, { status: 500 })

  // If there's already an active job for this price list, return it instead of
  // double-starting. This makes the endpoint safe to call repeatedly.
  const { data: existing } = await supabase
    .from('vivino_jobs')
    .select('id, state, total, processed')
    .eq('price_list_id', price_list_id)
    .in('state', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    runJob(existing.id)
    return NextResponse.json({
      job_id: existing.id,
      total: existing.total,
      processed: existing.processed,
      state: existing.state,
      message: 'job already in progress',
    })
  }

  let job
  try {
    job = await createJob(price_list_id, mode)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  if (job.total === 0) {
    return NextResponse.json({ enriched: 0, message: 'Nothing to enrich for this mode' })
  }

  runJob(job.job_id)
  return NextResponse.json({
    job_id: job.job_id,
    total: job.total,
    mode,
    message: 'Enrichment started',
  })
}
