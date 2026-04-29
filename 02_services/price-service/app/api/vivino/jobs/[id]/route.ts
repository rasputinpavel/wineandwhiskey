import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

type Action = 'pause' | 'resume' | 'cancel'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const action = body.action as Action

  if (!['pause', 'resume', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'action must be pause|resume|cancel' }, { status: 400 })
  }

  const { data: job } = await supabase.from('vivino_jobs').select('id, state').eq('id', id).maybeSingle()
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })

  if (action === 'pause') {
    if (job.state !== 'running' && job.state !== 'queued') {
      return NextResponse.json({ ok: true, state: job.state, noop: true })
    }
    await supabase.from('vivino_jobs').update({ state: 'paused' }).eq('id', id)
    return NextResponse.json({ ok: true, state: 'paused' })
  }

  if (action === 'resume') {
    if (job.state !== 'paused') return NextResponse.json({ ok: true, state: job.state, noop: true })
    await supabase.from('vivino_jobs').update({ state: 'running', heartbeat_at: new Date().toISOString() }).eq('id', id)
    // Trigger a tick to pick the job back up.
    const url = `${req.nextUrl.origin}/api/vivino/tick?job_id=${encodeURIComponent(id)}`
    fetch(url, { method: 'POST' }).catch(err => console.error('[vivino:jobs] resume trigger failed:', err))
    return NextResponse.json({ ok: true, state: 'running' })
  }

  if (action === 'cancel') {
    await supabase.from('vivino_jobs').update({ state: 'failed', finished_at: new Date().toISOString(), last_error: 'cancelled' }).eq('id', id)
    return NextResponse.json({ ok: true, state: 'failed' })
  }

  return NextResponse.json({ error: 'unreachable' }, { status: 500 })
}
