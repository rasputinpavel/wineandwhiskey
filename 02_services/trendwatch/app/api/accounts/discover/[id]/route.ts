import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabase
    .from('discover_jobs')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })

  // Auto-fail jobs that are running but haven't updated for >3 min — usually means
  // the background worker died (Railway redeploy, OOM, etc.).
  if (data.state === 'running') {
    const ageSec = (Date.now() - new Date(data.updated_at).getTime()) / 1000
    if (ageSec > 180) {
      await supabase.from('discover_jobs')
        .update({ state: 'failed', error: `worker stopped responding (${Math.round(ageSec)}s idle)` })
        .eq('id', id)
      data.state = 'failed'
      data.error = `worker stopped responding (${Math.round(ageSec)}s idle)`
    }
  }
  return NextResponse.json(data)
}

// DELETE — abort a running job. The background loop checks state every iteration
// and exits when it's no longer 'running'.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await supabase
    .from('discover_jobs')
    .update({ state: 'failed', error: 'cancelled by user', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('state', 'running')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
