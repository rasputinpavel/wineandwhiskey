import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { scrapeAccountReels } from '@/lib/apify'

export const runtime     = 'nodejs'
export const maxDuration = 600
export const dynamic     = 'force-dynamic'

const VIEWS_ABSOLUTE = 15_000  // niche-friendly threshold
const VIEWS_RELATIVE = 1.5     // views / followers

type FoundReel = {
  url:           string
  account:       string
  views:         number
  trigger_type:  'absolute' | 'relative' | 'both'
  ratio:         number
  thumbnail:     string | null
}

// ─── GET — latest sync job (running/done/failed) from last 2h ────────────────
export async function GET() {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('sync_jobs')
    .select('*')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const job = data?.[0]
  if (job && job.state === 'running') {
    const ageSec = (Date.now() - new Date(job.updated_at).getTime()) / 1000
    if (ageSec > 300) {
      await supabase.from('sync_jobs')
        .update({ state: 'failed', error: 'stale (no heartbeat)' })
        .eq('id', job.id)
      job.state = 'failed'
      job.error = 'stale (no heartbeat)'
    }
  }
  return NextResponse.json({ job: job ?? null })
}

// ─── POST — start a new sync job ─────────────────────────────────────────────
export async function POST() {
  const { data: accounts, error: accErr } = await supabase
    .from('trend_accounts')
    .select('id, username, followers_count')
    .eq('is_active', true)

  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 })
  if (!accounts?.length) {
    return NextResponse.json({ error: 'No active accounts. Activate accounts at /accounts first.' }, { status: 400 })
  }

  const { data: job, error } = await supabase
    .from('sync_jobs')
    .insert({ state: 'running', total_accounts: accounts.length })
    .select()
    .single()

  if (error || !job) {
    console.error('[sync POST] insert failed:', error)
    return NextResponse.json({ error: error?.message ?? 'failed to create job' }, { status: 500 })
  }

  void runSync(job.id, accounts).catch(async err => {
    console.error('[sync] job failed:', err)
    try { await appendLog(job.id, `✗ Фатальная ошибка: ${err?.message ?? err}`) } catch {}
    await supabase.from('sync_jobs')
      .update({ state: 'failed', error: String(err?.message ?? err), updated_at: new Date().toISOString() })
      .eq('id', job.id)
  })

  return NextResponse.json({ job_id: job.id })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function appendLog(jobId: string, message: string) {
  const { data } = await supabase.from('sync_jobs').select('logs').eq('id', jobId).single()
  const logs = (data?.logs ?? []) as string[]
  await supabase.from('sync_jobs')
    .update({ logs: [...logs, message], updated_at: new Date().toISOString() })
    .eq('id', jobId)
}

async function setPhase(jobId: string, current: number, total: number, label: string) {
  await supabase.from('sync_jobs')
    .update({ phase: 'account', phase_current: current, phase_total: total, phase_label: label, updated_at: new Date().toISOString() })
    .eq('id', jobId)
}

async function appendFound(jobId: string, reel: FoundReel) {
  const { data } = await supabase.from('sync_jobs').select('found_reels, total_new').eq('id', jobId).single()
  const arr = (data?.found_reels ?? []) as FoundReel[]
  await supabase.from('sync_jobs')
    .update({ found_reels: [...arr, reel], total_new: (data?.total_new ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq('id', jobId)
}

async function isCancelled(jobId: string): Promise<boolean> {
  const { data } = await supabase.from('sync_jobs').select('state').eq('id', jobId).single()
  return data?.state !== 'running'
}

// ─── Worker ──────────────────────────────────────────────────────────────────

type Account = { id: string; username: string; followers_count: number | null }

async function runSync(jobId: string, accounts: Account[]) {
  await appendLog(jobId, `🔄 Sync по ${accounts.length} активным аккаунтам. Порог: ≥${(VIEWS_ABSOLUTE/1000).toFixed(0)}K просмотров ИЛИ ≥${VIEWS_RELATIVE}x от подписчиков.`)

  let totalNew = 0

  for (let i = 0; i < accounts.length; i++) {
    if (await isCancelled(jobId)) { await appendLog(jobId, `⏹ Остановлено`); return }

    const account = accounts[i]
    await setPhase(jobId, i + 1, accounts.length, `@${account.username}`)
    await appendLog(jobId, `→ @${account.username}...`)

    try {
      const posts     = await scrapeAccountReels(account.username, 30)
      const followers = account.followers_count ?? 0

      const withViews = posts.filter(p => (p.videoPlayCount ?? 0) > 0)
      const topViews  = withViews.length ? Math.max(...withViews.map(p => p.videoPlayCount ?? 0)) : 0

      const highReach = posts.filter(p => {
        const v = p.videoPlayCount ?? 0
        return v >= VIEWS_ABSOLUTE || (followers > 0 && v / followers >= VIEWS_RELATIVE)
      })

      await appendLog(jobId,
        `  ${posts.length} Reels, ${withViews.length} с просмотрами` +
        (topViews > 0 ? ` (макс ${topViews.toLocaleString()})` : '') +
        `, ${highReach.length} прошли порог`,
      )

      let newForThisAccount = 0
      for (const post of highReach) {
        const instagramId = post.shortCode

        const { data: existing } = await supabase
          .from('trend_reels')
          .select('id')
          .eq('instagram_id', instagramId)
          .single()
        if (existing) continue

        const views       = post.videoPlayCount ?? 0
        const reelUrl     = post.url || `https://www.instagram.com/reel/${instagramId}/`
        const absoluteHit = views >= VIEWS_ABSOLUTE
        const relativeHit = followers > 0 && views / followers >= VIEWS_RELATIVE
        const triggerType: FoundReel['trigger_type'] =
          absoluteHit && relativeHit ? 'both' : absoluteHit ? 'absolute' : 'relative'
        const ratio = followers > 0 ? parseFloat((views / followers).toFixed(2)) : 0

        await supabase.from('trend_reels').insert({
          account_id:           account.id,
          instagram_id:         instagramId,
          url:                  reelUrl,
          views_count:          views,
          likes_count:          post.likesCount,
          comments_count:       post.commentsCount,
          caption:              post.caption,
          hashtags:             post.hashtags,
          thumbnail_url:        post.displayUrl,
          video_url:            post.videoUrl,
          duration_s:           post.videoDuration,
          published_at:         post.timestamp,
          status:               'new',
          trigger_type:         triggerType,
          views_at_capture:     views,
          followers_at_capture: followers,
          ratio_at_capture:     ratio,
        })

        await appendFound(jobId, {
          url:          reelUrl,
          account:      account.username,
          views,
          trigger_type: triggerType,
          ratio,
          thumbnail:    post.displayUrl ?? null,
        })

        newForThisAccount++
        totalNew++
      }

      if (posts.length > 0) {
        await supabase.from('trend_accounts')
          .update({ last_reel_at: new Date().toISOString() })
          .eq('id', account.id)
      }

      if (newForThisAccount > 0) {
        await appendLog(jobId, `  ✨ +${newForThisAccount} новых`)
      }
    } catch (err) {
      await appendLog(jobId, `  ✗ ошибка: ${(err as Error).message}`)
    }
  }

  await appendLog(jobId, `✅ Готово. Всего новых роликов: ${totalNew}`)
  await supabase.from('sync_jobs')
    .update({ state: 'done', phase: null, total_new: totalNew, updated_at: new Date().toISOString() })
    .eq('id', jobId)
}
