import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { tickJob } from '@/lib/vivino/enrich'

// Long timeout — one tick can take up to ~10 min when it triggers an Apify run.
export const maxDuration = 600

export async function POST(req: NextRequest) {
  const job_id = req.nextUrl.searchParams.get('job_id')
  if (!job_id) {
    // No job_id: process the oldest active job (cron mode).
    const { data: next } = await supabase
      .from('vivino_jobs')
      .select('id')
      .in('state', ['queued', 'running'])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!next) return NextResponse.json({ idle: true })
    return runTick(req.nextUrl.origin, next.id)
  }
  return runTick(req.nextUrl.origin, job_id)
}

export async function GET(req: NextRequest) {
  // Allow GET so Railway/Vercel cron can hit it without body.
  return POST(req)
}

async function runTick(origin: string, job_id: string) {
  let result: { remaining: number; finished: boolean }
  try {
    result = await tickJob(job_id)
  } catch (e) {
    const msg = (e as Error).message
    console.error('[vivino:tick] failed:', msg)
    await supabase.from('vivino_jobs').update({ last_error: msg, heartbeat_at: new Date().toISOString() }).eq('id', job_id)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  if (!result.finished && result.remaining > 0) {
    // Self-chain to keep the job rolling without external cron.
    const url = `${origin}/api/vivino/tick?job_id=${encodeURIComponent(job_id)}`
    fetch(url, { method: 'POST' }).catch(err => console.error('[vivino:tick] chain failed:', err))
  }

  return NextResponse.json({ job_id, remaining: result.remaining, finished: result.finished })
}
