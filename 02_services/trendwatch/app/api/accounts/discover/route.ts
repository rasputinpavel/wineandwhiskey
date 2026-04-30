import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { scrapeHashtagReels, scrapeProfile, type InstagramPost } from '@/lib/apify'
import { analyzeAccount, type AccountAnalysis } from '@/lib/claude'

export const runtime     = 'nodejs'
export const maxDuration = 600
export const dynamic     = 'force-dynamic'

// ─── Hashtag → cluster mapping ───────────────────────────────────────────────

const HASHTAG_TO_CLUSTER: Record<string, string> = {
  winestore: 'retail', wineshop: 'retail', wineretail: 'retail', finewine: 'retail', bottleshop: 'retail',
  winebar: 'venue', winelounge: 'venue', enoteca: 'venue',
  naturalwine: 'style', orangewine: 'style',
  sommelier: 'authority', wineeducator: 'authority',
  whiskybar: 'adjacent', winelovers: 'adjacent', winelover: 'adjacent',
}

// ─── Stats helpers ───────────────────────────────────────────────────────────

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2
}
function p75(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(Math.floor(s.length * 0.75), s.length - 1)]
}
function top3Avg(arr: number[]): number {
  const top = [...arr].sort((a, b) => b - a).slice(0, 3)
  return Math.round(top.reduce((a, b) => a + b, 0) / top.length)
}
function sizeBucket(followers: number): string {
  if (followers < 10_000)  return 'micro'
  if (followers < 50_000)  return 'small'
  if (followers < 250_000) return 'mid'
  return 'large'
}
function logNorm(ratio: number): number {
  return Math.min(Math.log2(ratio + 1) / Math.log2(201), 1)
}
function computeStability(views: number[]): { ratio: number; label: 'good' | 'watch' | 'low' | 'unknown' } {
  const med = median(views)
  if (med === 0) return { ratio: 0, label: 'unknown' }
  const ratio = Math.max(...views) / med
  return {
    ratio: parseFloat(ratio.toFixed(1)),
    label: ratio < 5 ? 'good' : ratio < 10 ? 'watch' : 'low',
  }
}
function computeFreshness(posts: InstagramPost[]): number {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const recent = posts.filter(p => new Date(p.timestamp).getTime() >= cutoff)
  const recentViews = recent.map(p => p.videoPlayCount ?? 0).filter(v => v > 0)
  return parseFloat(Math.min(recentViews.length / 4, 1).toFixed(2))
}
function computeConfidence(
  sampleSize: number, matchedClusters: number, hasBio: boolean,
  verdict: string, stabilityLabel: string,
): number {
  let s = 0
  s += sampleSize >= 12 ? 0.30 : sampleSize >= 6 ? 0.20 : 0.10
  s += matchedClusters >= 3 ? 0.25 : matchedClusters >= 2 ? 0.15 : 0.05
  s += hasBio ? 0.15 : 0
  s += verdict === 'keep' ? 0.20 : verdict === 'maybe' ? 0.10 : 0
  s += stabilityLabel === 'good' ? 0.10 : stabilityLabel === 'watch' ? 0.05 : 0
  return parseFloat(Math.min(s, 1).toFixed(2))
}
function assignTier(score: number, confidence: number): 'a' | 'b' | 'c' {
  if (score >= 8 && confidence >= 0.5) return 'a'
  if (score >= 5 || confidence >= 0.35) return 'b'
  return 'c'
}
function computeScore(
  medianRatio: number, p75Ratio: number, top1Ratio: number,
  hitRate: number, a: AccountAnalysis, confidence: number,
): number {
  const copyability = (
    a.format_copyability * 0.25 +
    a.production_copyability * 0.25 +
    a.retail_copyability * 0.50
  ) / 5
  const raw =
    0.25 * logNorm(medianRatio) +
    0.18 * logNorm(p75Ratio) +
    0.12 * logNorm(top1Ratio) +
    0.15 * hitRate +
    0.15 * copyability +
    0.08 * (a.retail_idea_density / 5) +
    0.07 * confidence
  return Math.round(raw * 9 + 1)
}

// ─── Candidate type stored in discover_jobs.candidates ───────────────────────

type Candidate = {
  username:               string
  display_name:           string | null
  followers_count:        number
  avg_reel_views:         number
  median_reel_views:      number
  top3_avg_views:         number
  hit_rate_50k:           number
  virality_ratio:         number
  size_bucket:            string
  source_clusters:        string[]
  matched_clusters_count: number
  sample_size:            number
  top1_median_ratio:      number
  stability_label:        string
  freshness_score:        number
  confidence_score:       number
  format_copyability:     number
  production_copyability: number
  retail_copyability:     number
  business_model:         string
  why_matters:            string
  verdict:                string
  relevance_score:        number
  tier:                   'a' | 'b' | 'c'
  category:               string
  sample_reel_url:        string | null
}

// ─── GET — return latest job from last 2h ────────────────────────────────────
export async function GET() {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('discover_jobs')
    .select('*')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const job = data?.[0]
  if (job && job.state === 'running') {
    const ageSec = (Date.now() - new Date(job.updated_at).getTime()) / 1000
    if (ageSec > 300) {
      await supabase.from('discover_jobs')
        .update({ state: 'failed', error: 'stale (no heartbeat)' })
        .eq('id', job.id)
      job.state = 'failed'; job.error = 'stale (no heartbeat)'
    }
  }
  return NextResponse.json({ job: job ?? null })
}

// ─── POST — start new job ────────────────────────────────────────────────────
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
    console.error('[discover POST] insert failed:', error)
    return NextResponse.json({ error: error?.message ?? 'failed to create job' }, { status: 500 })
  }

  void runDiscovery(job.id, tags).catch(async err => {
    console.error('[discover] job failed:', err)
    try { await appendLog(job.id, `✗ Фатальная ошибка: ${err?.message ?? err}`) } catch {}
    await supabase.from('discover_jobs')
      .update({ state: 'failed', error: String(err?.message ?? err), updated_at: new Date().toISOString() })
      .eq('id', job.id)
  })

  return NextResponse.json({ job_id: job.id })
}

// ─── Worker helpers ──────────────────────────────────────────────────────────

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
async function isCancelled(jobId: string): Promise<boolean> {
  const { data } = await supabase.from('discover_jobs').select('state').eq('id', jobId).single()
  return data?.state !== 'running'
}

// ─── Main worker ─────────────────────────────────────────────────────────────

const MAX_ACCOUNTS_TO_ENRICH = 100
// 2 reels = enough signal in pre-filter; the per-account scoring still uses
// median/p75/etc on whatever sample we have. Was 3 — too strict, killed ~95%
// of candidates on a 14-hashtag run.
const MIN_REELS_PER_ACCOUNT  = 2

async function runDiscovery(jobId: string, tags: string[]) {
  await appendLog(jobId, `🔍 Запускаю поиск по ${tags.length} хэштегам — ~${Math.round(tags.length * 0.7)} мин на скан + ~30 мин на профили.`)

  const postsByAccount    = new Map<string, InstagramPost[]>()
  const clustersByAccount = new Map<string, Set<string>>()

  for (let i = 0; i < tags.length; i++) {
    if (await isCancelled(jobId)) { await appendLog(jobId, `⏹ Остановлено`); return }
    const tag = tags[i]
    const cluster = HASHTAG_TO_CLUSTER[tag.toLowerCase()] ?? 'custom'
    await setPhase(jobId, 'hashtag', i + 1, tags.length, `#${tag}`)
    await appendLog(jobId, `  → Сканирую #${tag} [${cluster}]...`)
    try {
      const posts = await scrapeHashtagReels(tag, 50)
      await appendLog(jobId, `  ← #${tag}: найдено ${posts.length} Reels`)
      for (const post of posts) {
        if (!postsByAccount.has(post.ownerUsername)) {
          postsByAccount.set(post.ownerUsername, [])
          clustersByAccount.set(post.ownerUsername, new Set())
        }
        postsByAccount.get(post.ownerUsername)!.push(post)
        clustersByAccount.get(post.ownerUsername)!.add(cluster)
      }
    } catch (err) {
      await appendLog(jobId, `  ✗ #${tag} — ошибка: ${(err as Error).message}`)
    }
  }

  // Pre-filter: ≥ MIN_REELS_PER_ACCOUNT, top by total views, cap MAX_ACCOUNTS_TO_ENRICH
  const all = [...postsByAccount.entries()]
  const filtered = all
    .filter(([, posts]) => posts.filter(p => (p.videoPlayCount ?? 0) > 0).length >= MIN_REELS_PER_ACCOUNT)
    .map(([username, posts]) => ({
      username, posts,
      totalViews: posts.reduce((sum, p) => sum + (p.videoPlayCount ?? 0), 0),
    }))
    .sort((a, b) => b.totalViews - a.totalViews)
    .slice(0, MAX_ACCOUNTS_TO_ENRICH)

  const skipped = all.length - filtered.length
  await appendLog(jobId, `📊 Найдено ${all.length} аккаунтов. Фильтр: ≥${MIN_REELS_PER_ACCOUNT} Reels + топ-${MAX_ACCOUNTS_TO_ENRICH} по просмотрам.`)
  await appendLog(jobId, `   Пропущено ${skipped} (мало роликов). К обогащению: ${filtered.length}.`)

  for (let i = 0; i < filtered.length; i++) {
    if (await isCancelled(jobId)) { await appendLog(jobId, `⏹ Остановлено`); return }
    const { username, posts } = filtered[i]
    await setPhase(jobId, 'account', i + 1, filtered.length, `@${username}`)

    try {
      const profile = await scrapeProfile(username)
      if (!profile) { await appendLog(jobId, `  · @${username} — профиль не найден`); continue }

      const followers = profile.followersCount ?? 0
      if (followers < 2_000 || followers > 3_000_000) {
        await appendLog(jobId, `  · @${username} — пропуск (${followers.toLocaleString()} flw)`)
        continue
      }

      const views = posts.map(p => p.videoPlayCount ?? 0).filter(v => v > 0)
      const avgViews    = Math.round(views.reduce((a, b) => a + b, 0) / views.length)
      const medianViews = Math.round(median(views))
      const p75Views    = Math.round(p75(views))
      const top3Views   = top3Avg(views)
      const hitRate     = views.filter(v => v >= 50_000).length / views.length
      const medianRatio = medianViews / followers
      const p75Ratio    = p75Views / followers
      const top1Ratio   = Math.max(...views) / followers

      const stability      = computeStability(views)
      const freshnessScore = computeFreshness(posts)
      const sourceClusters = [...(clustersByAccount.get(username) ?? [])]
      const bio            = profile.biography ?? ''
      const captions       = posts.map(p => p.caption ?? '').filter(Boolean)
      const bucket         = sizeBucket(followers)

      const analysis = await analyzeAccount({
        username, followers, medianViews, top3Views, hitRate, medianRatio,
        stabilityLabel: stability.label, sourceClusters, bio, sampleCaptions: captions,
      })

      if (analysis.verdict === 'reject') {
        await appendLog(jobId, `  ✗ @${username} — reject (${analysis.red_flags.join(', ')})`)
        continue
      }

      const confidence = computeConfidence(views.length, sourceClusters.length, !!bio, analysis.verdict, stability.label)
      const score      = computeScore(medianRatio, p75Ratio, top1Ratio, hitRate, analysis, confidence)
      const tier       = assignTier(score, confidence)

      const candidate: Candidate = {
        username,
        display_name:           profile.fullName,
        followers_count:        followers,
        avg_reel_views:         avgViews,
        median_reel_views:      medianViews,
        top3_avg_views:         top3Views,
        hit_rate_50k:           parseFloat(hitRate.toFixed(3)),
        virality_ratio:         parseFloat(medianRatio.toFixed(2)),
        size_bucket:            bucket,
        source_clusters:        sourceClusters,
        matched_clusters_count: sourceClusters.length,
        sample_size:            views.length,
        top1_median_ratio:      stability.ratio,
        stability_label:        stability.label,
        freshness_score:        freshnessScore,
        confidence_score:       confidence,
        format_copyability:     analysis.format_copyability,
        production_copyability: analysis.production_copyability,
        retail_copyability:     analysis.retail_copyability,
        business_model:         analysis.business_model_fit,
        why_matters:            analysis.why_matters,
        verdict:                analysis.verdict,
        relevance_score:        score,
        tier,
        category:               analysis.business_model_fit,
        sample_reel_url:        posts[0]?.url ?? null,
      }
      await appendCandidate(jobId, candidate)
      await appendLog(jobId,
        `  ${tier === 'a' ? '🔴 A' : tier === 'b' ? '🟡 B' : '⚪ C'} @${username} — ` +
        `${followers.toLocaleString()} flw · med ${medianViews.toLocaleString()} · ` +
        `stab ${stability.label} · conf ${confidence} · ${score}/10 — ${analysis.why_matters}`,
      )
    } catch (err) {
      await appendLog(jobId, `  ✗ @${username} — ошибка: ${(err as Error).message}`)
    }
  }

  await appendLog(jobId, `✅ Готово`)
  await supabase.from('discover_jobs')
    .update({ state: 'done', phase: null, updated_at: new Date().toISOString() })
    .eq('id', jobId)
}
