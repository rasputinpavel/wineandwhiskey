import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { scrapeHashtagReels, scrapeProfile, type InstagramPost } from '@/lib/apify'
import { scoreAccountRelevance } from '@/lib/claude'

export const runtime     = 'nodejs'
export const maxDuration = 600
export const dynamic     = 'force-dynamic'

type Candidate = {
  username:        string
  display_name:    string | null
  followers_count: number
  avg_reel_views:  number
  relevance_score: number
  category:        string
  sample_reel_url: string | null
}

// ─── GET — return latest active job (for reload resume) ──────────────────────
export async function GET() {
  const { data, error } = await supabase
    .from('discover_jobs')
    .select('*')
    .eq('state', 'running')
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Stale job (no update >5 min) → mark failed and report no active
  const job = data?.[0]
  if (job) {
    const ageSec = (Date.now() - new Date(job.updated_at).getTime()) / 1000
    if (ageSec > 300) {
      await supabase.from('discover_jobs').update({ state: 'failed', error: 'stale (no heartbeat)' }).eq('id', job.id)
      return NextResponse.json({ job: null })
    }
  }
  return NextResponse.json({ job: job ?? null })
}

// ─── POST — start a new job, return id immediately ──────────────────────────
export async function POST(req: NextRequest) {
  const { hashtags } = await req.json() as { hashtags: string[] }
  if (!hashtags?.length) {
    return NextResponse.json({ error: 'hashtags required' }, { status: 400 })
  }

  const tags = hashtags.slice(0, 20).map(t => t.trim().replace(/^#/, '')).filter(Boolean)

  const { data: job, error } = await supabase
    .from('discover_jobs')
    .insert({ hashtags: tags, state: 'running' })
    .select()
    .single()

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? 'failed to create job' }, { status: 500 })
  }

  // Fire and forget — runs after response is sent
  void runDiscovery(job.id, tags).catch(async err => {
    console.error('[discover] job failed:', err)
    await supabase.from('discover_jobs')
      .update({ state: 'failed', error: String(err?.message ?? err), updated_at: new Date().toISOString() })
      .eq('id', job.id)
  })

  return NextResponse.json({ job_id: job.id })
}

// ─── Background worker ──────────────────────────────────────────────────────

async function appendLog(jobId: string, message: string) {
  const { data } = await supabase.from('discover_jobs').select('logs').eq('id', jobId).single()
  const logs = (data?.logs ?? []) as string[]
  await supabase.from('discover_jobs')
    .update({ logs: [...logs, message], updated_at: new Date().toISOString() })
    .eq('id', jobId)
}

async function setPhase(jobId: string, phase: string, current: number, total: number, label: string) {
  await supabase.from('discover_jobs')
    .update({ phase, phase_current: current, phase_total: total, phase_label: label, updated_at: new Date().toISOString() })
    .eq('id', jobId)
}

async function appendCandidate(jobId: string, candidate: Candidate) {
  const { data } = await supabase.from('discover_jobs').select('candidates').eq('id', jobId).single()
  const arr = (data?.candidates ?? []) as Candidate[]
  await supabase.from('discover_jobs')
    .update({ candidates: [...arr, candidate], updated_at: new Date().toISOString() })
    .eq('id', jobId)
}

async function runDiscovery(jobId: string, tags: string[]) {
  await appendLog(jobId, `🔍 Запускаю поиск по ${tags.length} хэштегам — каждый занимает 30–90 сек, всего ~${Math.round(tags.length * 0.7)} мин.`)

  const postsByAccount = new Map<string, InstagramPost[]>()

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]
    await setPhase(jobId, 'hashtag', i + 1, tags.length, `#${tag}`)
    await appendLog(jobId, `  → Сканирую #${tag}...`)
    try {
      const posts = await scrapeHashtagReels(tag, 50)
      await appendLog(jobId, `  ← #${tag}: найдено ${posts.length} Reels`)
      for (const post of posts) {
        if (!postsByAccount.has(post.ownerUsername)) postsByAccount.set(post.ownerUsername, [])
        postsByAccount.get(post.ownerUsername)!.push(post)
      }
    } catch (err) {
      await appendLog(jobId, `  ✗ #${tag} — ошибка: ${(err as Error).message}`)
    }
  }

  const accounts = [...postsByAccount.entries()]
  await appendLog(jobId, `📊 Уникальных аккаунтов: ${accounts.length}. Обогащаю профили...`)

  for (let i = 0; i < accounts.length; i++) {
    const [username, posts] = accounts[i]
    await setPhase(jobId, 'account', i + 1, accounts.length, `@${username}`)

    try {
      const profile = await scrapeProfile(username)
      if (!profile) { await appendLog(jobId, `  · @${username} — профиль не найден`); continue }

      const followers = profile.followersCount
      if (followers < 2_000 || followers > 2_000_000) {
        await appendLog(jobId, `  · @${username} — пропуск (${followers.toLocaleString()} фолловеров)`)
        continue
      }

      const views    = posts.map(p => p.videoPlayCount ?? 0).filter(v => v > 0)
      const avgViews = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0
      const captions = posts.map(p => p.caption ?? '').filter(Boolean)

      const score = await scoreAccountRelevance({
        username, followersCount: followers, recentReelViews: views, sampleCaptions: captions,
      })

      const candidate: Candidate = {
        username,
        display_name:    profile.fullName,
        followers_count: followers,
        avg_reel_views:  avgViews,
        relevance_score: score,
        category:        'wine_store',
        sample_reel_url: posts[0]?.url ?? null,
      }
      await appendCandidate(jobId, candidate)
      await appendLog(jobId, `  ✓ @${username} — ${followers.toLocaleString()} flw · ${avgViews.toLocaleString()} avg · ${score}/10`)
    } catch (err) {
      await appendLog(jobId, `  ✗ @${username} — ошибка: ${(err as Error).message}`)
    }
  }

  await appendLog(jobId, `✅ Готово`)
  await supabase.from('discover_jobs')
    .update({ state: 'done', phase: null, updated_at: new Date().toISOString() })
    .eq('id', jobId)
}
