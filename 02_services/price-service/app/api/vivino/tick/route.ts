import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { runJob } from '@/lib/vivino/enrich'

// One tick can take up to ~10 min when it triggers an Apify run; we kick the
// in-process loop and return immediately, so this handler itself stays fast.
export const maxDuration = 600

export async function POST(req: NextRequest) {
  const job_id = req.nextUrl.searchParams.get('job_id')
  if (job_id) {
    runJob(job_id)
    return NextResponse.json({ job_id, kicked: true })
  }

  // No job_id: pick up the oldest active job (cron / manual recovery).
  const { data: next } = await supabase
    .from('vivino_jobs')
    .select('id')
    .in('state', ['queued', 'running'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!next) return NextResponse.json({ idle: true })
  runJob(next.id)
  return NextResponse.json({ job_id: next.id, kicked: true })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
