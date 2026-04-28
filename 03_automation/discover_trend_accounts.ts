/**
 * discover_trend_accounts.ts — v3
 *
 * v2 → v3 additions:
 * - Stability metric: top1/median ratio (good <5x, watch 5–10x, low >10x)
 * - Confidence score: sample_size + cluster coverage + bio + Claude verdict
 * - Freshness score: how many strong reels posted in last 30 days
 * - Decomposed copyability: format / production / retail (3 separate Claude fields)
 * - Tier assignment: a (daily sync) / b (watchlist) / c (archive)
 * - matched_clusters_count saved for filtering in UI
 *
 * Usage:
 *   npm run discover-accounts
 *   npm run discover-accounts -- --clusters=retail,venue
 *   npm run discover-accounts -- --hashtags=winestore,wineshop
 *
 * Requires migrations 002 + 003 applied in Supabase.
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const claude   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const APIFY_TOKEN = process.env.APIFY_TOKEN!
const BASE = 'https://api.apify.com/v2'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Hashtag clusters ─────────────────────────────────────────────────────────

const HASHTAG_CLUSTERS: Record<string, string[]> = {
  retail:    ['winestore', 'wineshop', 'wineretail', 'finewine', 'bottleshop'],
  venue:     ['winebar', 'winelounge', 'enoteca'],
  style:     ['naturalwine', 'orangewine'],
  authority: ['sommelier', 'wineeducator'],
  adjacent:  ['whiskybar', 'winelovers'],
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Post = {
  type:           string
  shortCode:      string
  ownerUsername:  string
  ownerFullName:  string | null
  videoPlayCount: number | null
  caption:        string | null
  url:            string
  timestamp:      string
}

type Profile = {
  username:      string
  fullName:      string | null
  followersCount: number
  biography?:    string
}

type AccountAnalysis = {
  business_model_fit:      string
  content_format_strength: number
  retail_idea_density:     number
  format_copyability:      number   // can you replicate the mechanic easily?
  production_copyability:  number   // does it require a team/studio/budget?
  retail_copyability:      number   // works specifically for a wine shop?
  red_flags:               string[]
  why_matters:             string
  verdict:                 'keep' | 'maybe' | 'reject'
}

// ─── Stats helpers ────────────────────────────────────────────────────────────

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

function computeStability(views: number[]): { ratio: number; label: string } {
  const med  = median(views)
  if (med === 0) return { ratio: 0, label: 'unknown' }
  const top1 = Math.max(...views)
  const ratio = top1 / med
  return {
    ratio: parseFloat(ratio.toFixed(1)),
    label: ratio < 5 ? 'good' : ratio < 10 ? 'watch' : 'low',
  }
}

function computeFreshness(posts: Post[]): number {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const recent = posts.filter(p => new Date(p.timestamp).getTime() >= cutoff)
  const recentViews = recent.map(p => p.videoPlayCount ?? 0).filter(v => v > 0)
  // 0–1: saturates at 4+ recent reels with views
  return parseFloat(Math.min(recentViews.length / 4, 1).toFixed(2))
}

function computeConfidence(
  sampleSize:      number,
  matchedClusters: number,
  hasBio:          boolean,
  verdict:         string,
  stabilityLabel:  string,
): number {
  let score = 0
  score += sampleSize >= 12 ? 0.30 : sampleSize >= 6 ? 0.20 : 0.10
  score += matchedClusters >= 3 ? 0.25 : matchedClusters >= 2 ? 0.15 : 0.05
  score += hasBio ? 0.15 : 0
  score += verdict === 'keep' ? 0.20 : verdict === 'maybe' ? 0.10 : 0
  score += stabilityLabel === 'good' ? 0.10 : stabilityLabel === 'watch' ? 0.05 : 0
  return parseFloat(Math.min(score, 1).toFixed(2))
}

function assignTier(score: number, confidence: number): string {
  if (score >= 8 && confidence >= 0.5) return 'a'   // daily sync
  if (score >= 5 || confidence >= 0.35) return 'b'  // watchlist
  return 'c'                                          // archive
}

// ─── Apify helpers ────────────────────────────────────────────────────────────

async function runApify(actorId: string, input: Record<string, unknown>): Promise<{ runId: string; datasetId: string }> {
  const res = await fetch(`${BASE}/acts/${actorId}/runs`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Apify start failed: ${await res.text()}`)
  const { data } = await res.json() as { data: { id: string; defaultDatasetId: string } }
  return { runId: data.id, datasetId: data.defaultDatasetId }
}

async function pollApify(runId: string, maxMs = 300_000): Promise<void> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    await sleep(10_000)
    const res    = await fetch(`${BASE}/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } })
    const { data } = await res.json() as { data: { status: string } }
    if (data.status === 'SUCCEEDED') return
    if (data.status === 'FAILED' || data.status === 'ABORTED') throw new Error(`Apify run ${data.status}`)
  }
  throw new Error('Apify timed out')
}

async function getDataset<T>(datasetId: string): Promise<T[]> {
  const res = await fetch(`${BASE}/datasets/${datasetId}/items?clean=true`, {
    headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
  })
  return res.json()
}

async function scrapeHashtag(hashtag: string): Promise<Post[]> {
  console.log(`  Scraping #${hashtag}…`)
  const { runId, datasetId } = await runApify('apify~instagram-scraper', {
    directUrls:   [`https://www.instagram.com/explore/tags/${hashtag}/`],
    resultsType:  'reels',
    resultsLimit: 60,
  })
  await pollApify(runId)
  const items = await getDataset<Post>(datasetId)
  return items.filter(p => p.videoPlayCount != null)
}

async function getProfile(username: string): Promise<Profile | null> {
  const { runId, datasetId } = await runApify('apify~instagram-profile-scraper', {
    usernames: [username],
  })
  await pollApify(runId, 60_000)
  const items = await getDataset<Profile>(datasetId)
  return items[0] ?? null
}

// ─── Claude structured analysis ───────────────────────────────────────────────

async function analyzeAccount(
  username:        string,
  followers:       number,
  medianViews:     number,
  top3Views:       number,
  hitRate:         number,
  medianRatio:     number,
  stabilityLabel:  string,
  sourceClusters:  string[],
  bio:             string,
  captions:        string[],
): Promise<AccountAnalysis> {
  const prompt =
    `You are scoring Instagram accounts as content inspiration for Wine & Whiskey — ` +
    `a wine & spirits retail store in Phuket (Russian-speaking audience, casual luxury tone).\n\n` +
    `Account: @${username}\n` +
    `Followers: ${followers.toLocaleString()}\n` +
    `Median Reel views: ${medianViews.toLocaleString()}\n` +
    `Top-3 avg views: ${top3Views.toLocaleString()}\n` +
    `Views/followers (median): ${medianRatio.toFixed(1)}x\n` +
    `Hit rate (reels >50K views): ${(hitRate * 100).toFixed(0)}%\n` +
    `Virality stability: ${stabilityLabel} (top1/median ratio)\n` +
    `Found via clusters: ${sourceClusters.join(', ')}\n` +
    `Bio: ${bio || '(none)'}\n` +
    `Sample captions: ${captions.slice(0, 3).join(' | ') || '(none)'}\n\n` +
    `Return ONLY valid JSON, no markdown:\n` +
    `{"business_model_fit":"wine_shop|wine_bar|media|creator|other",` +
    `"content_format_strength":1-5,` +
    `"retail_idea_density":1-5,` +
    `"format_copyability":1-5,` +
    `"production_copyability":1-5,` +
    `"retail_copyability":1-5,` +
    `"red_flags":["..."],` +
    `"why_matters":"one specific sentence",` +
    `"verdict":"keep|maybe|reject"}\n\n` +
    `Copyability guide:\n` +
    `- format_copyability: can you replicate the reel mechanic without a team?\n` +
    `- production_copyability: 5=shot on phone, 1=requires studio/pro crew\n` +
    `- retail_copyability: 5=perfect for a wine shop, 1=only works for creator/media`

  const res = await claude.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = res.content[0].type === 'text' ? res.content[0].text.trim() : '{}'
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim()) as AccountAnalysis
  } catch {
    return {
      business_model_fit:      'other',
      content_format_strength: 3,
      retail_idea_density:     3,
      format_copyability:      3,
      production_copyability:  3,
      retail_copyability:      3,
      red_flags:               [],
      why_matters:             '',
      verdict:                 'maybe',
    }
  }
}

function computeScore(
  medianRatio:    number,
  p75Ratio:       number,
  top1Ratio:      number,
  hitRate:        number,
  analysis:       AccountAnalysis,
  confidence:     number,
): number {
  const copyability = (
    analysis.format_copyability * 0.25 +
    analysis.production_copyability * 0.25 +
    analysis.retail_copyability * 0.50   // retail fit weighted double
  ) / 5

  const raw =
    0.25 * logNorm(medianRatio) +
    0.18 * logNorm(p75Ratio) +
    0.12 * logNorm(top1Ratio) +
    0.15 * hitRate +
    0.15 * copyability +
    0.08 * (analysis.retail_idea_density / 5) +
    0.07 * confidence

  return Math.round(raw * 9 + 1) // 0–1 → 1–10
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)

  const clusterArg = args.find(a => a.startsWith('--clusters='))?.split('=')[1]
  const hashtagArg = args.find(a => a.startsWith('--hashtags='))?.split('=')[1]

  let clusterMap: Map<string, string>
  let hashtags: string[]

  if (hashtagArg) {
    hashtags   = hashtagArg.split(',').map(t => t.trim().replace(/^#/, ''))
    clusterMap = new Map(hashtags.map(t => [t, 'custom']))
  } else {
    const activeClusters = clusterArg
      ? Object.fromEntries(clusterArg.split(',').map(c => [c, HASHTAG_CLUSTERS[c] ?? []]))
      : HASHTAG_CLUSTERS
    hashtags   = Object.values(activeClusters).flat()
    clusterMap = new Map(
      Object.entries(activeClusters).flatMap(([c, tags]) => tags.map(t => [t, c]))
    )
  }

  const clusterNames = [...new Set(clusterMap.values())]
  console.log(`\n🔍 Discovering from ${hashtags.length} hashtags across ${clusterNames.length} clusters: ${clusterNames.join(', ')}\n`)

  // ── Collect posts ─────────────────────────────────────────────────────────
  const postsByAccount    = new Map<string, Post[]>()
  const clustersByAccount = new Map<string, Set<string>>()

  for (const tag of hashtags) {
    try {
      const posts   = await scrapeHashtag(tag)
      const cluster = clusterMap.get(tag) ?? 'unknown'
      console.log(`  → ${posts.length} Reels from #${tag} [${cluster}]`)

      for (const post of posts) {
        if (!postsByAccount.has(post.ownerUsername)) {
          postsByAccount.set(post.ownerUsername, [])
          clustersByAccount.set(post.ownerUsername, new Set())
        }
        postsByAccount.get(post.ownerUsername)!.push(post)
        clustersByAccount.get(post.ownerUsername)!.add(cluster)
      }
    } catch (err) {
      console.error(`  ✗ #${tag} failed:`, err)
    }
    await sleep(2000)
  }

  console.log(`\n📊 Found ${postsByAccount.size} unique accounts. Enriching profiles…\n`)

  type Candidate = {
    username:             string
    displayName:          string | null
    followers:            number
    bucket:               string
    tier:                 string
    sourceClusters:       string[]
    matchedClustersCount: number
    sampleSize:           number
    avgViews:             number
    medianViews:          number
    top3Views:            number
    hitRate:              number
    viralityRatio:        number
    stabilityRatio:       number
    stabilityLabel:       string
    freshnessScore:       number
    confidenceScore:      number
    score:                number
    analysis:             AccountAnalysis
    sampleUrl:            string
  }

  const candidates: Candidate[] = []

  for (const [username, posts] of postsByAccount.entries()) {
    try {
      process.stdout.write(`  @${username}… `)

      const views = posts.map(p => p.videoPlayCount ?? 0).filter(v => v > 0)
      if (views.length < 3) {
        console.log(`skip (only ${views.length} reels — need ≥3)`)
        continue
      }

      const profile = await getProfile(username)
      if (!profile) { console.log('no profile'); continue }

      const followers = profile.followersCount ?? 0
      if (followers < 2_000 || followers > 3_000_000) {
        console.log(`skip (${followers.toLocaleString()} followers)`)
        continue
      }

      // Metrics
      const avgViews    = Math.round(views.reduce((a, b) => a + b, 0) / views.length)
      const medianViews = Math.round(median(views))
      const p75Views    = Math.round(p75(views))
      const top3Views   = top3Avg(views)
      const hitRate     = views.filter(v => v >= 50_000).length / views.length
      const medianRatio = followers > 0 ? medianViews / followers : 0
      const p75Ratio    = followers > 0 ? p75Views    / followers : 0
      const top1Ratio   = followers > 0 ? Math.max(...views) / followers : 0

      const stability      = computeStability(views)
      const freshnessScore = computeFreshness(posts)

      const sourceClusters       = [...(clustersByAccount.get(username) ?? [])]
      const matchedClustersCount = sourceClusters.length
      const bio                  = profile.biography ?? ''
      const captions             = posts.map(p => p.caption ?? '').filter(Boolean)
      const bucket               = sizeBucket(followers)

      const analysis = await analyzeAccount(
        username, followers, medianViews, top3Views, hitRate,
        medianRatio, stability.label, sourceClusters, bio, captions,
      )

      if (analysis.verdict === 'reject') {
        console.log(`reject — ${analysis.red_flags.join(', ')}`)
        continue
      }

      const confidenceScore = computeConfidence(
        views.length, matchedClustersCount, !!bio, analysis.verdict, stability.label,
      )
      const score = computeScore(medianRatio, p75Ratio, top1Ratio, hitRate, analysis, confidenceScore)
      const tier  = assignTier(score, confidenceScore)

      console.log(
        `${bucket.padEnd(6)} | tier=${tier} med=${medianViews.toLocaleString()} ratio=${medianRatio.toFixed(1)}x ` +
        `stab=${stability.label} hit=${(hitRate * 100).toFixed(0)}% conf=${confidenceScore} ${score}/10` +
        (analysis.why_matters ? ` | ${analysis.why_matters.slice(0, 50)}` : '')
      )

      candidates.push({
        username, displayName: profile.fullName, followers, bucket, tier,
        sourceClusters, matchedClustersCount, sampleSize: views.length,
        avgViews, medianViews, top3Views, hitRate, viralityRatio: medianRatio,
        stabilityRatio: stability.ratio, stabilityLabel: stability.label,
        freshnessScore, confidenceScore, score, analysis, sampleUrl: posts[0]?.url ?? '',
      })
    } catch (err) {
      console.error(`  ✗ @${username}:`, err)
    }
    await sleep(1000)
  }

  // ── Rank within size buckets → blend top 30 ───────────────────────────────
  const ranked: Candidate[] = []
  for (const b of ['micro', 'small', 'mid', 'large']) {
    const inBucket = candidates.filter(c => c.bucket === b).sort((a, z) => z.score - a.score)
    ranked.push(...inBucket.slice(0, 8))
  }
  ranked.sort((a, z) => z.score - a.score)
  const top30 = ranked.slice(0, 30)

  console.log(`\n✅ Top ${top30.length} candidates:\n`)
  const tierLabel: Record<string, string> = { a: '🔴 A', b: '🟡 B', c: '⚪ C' }
  for (const c of top30) {
    console.log(
      `  [${c.score}/10] ${tierLabel[c.tier] ?? c.tier} ${c.bucket.padEnd(6)} @${c.username.padEnd(30)} ` +
      `flw=${String(c.followers).padStart(7)} med=${String(c.medianViews).padStart(7)} ` +
      `stab=${c.stabilityLabel} conf=${c.confidenceScore} fresh=${c.freshnessScore}`
    )
    if (c.analysis.why_matters) console.log(`         → ${c.analysis.why_matters}`)
  }

  // ── Summary by tier ───────────────────────────────────────────────────────
  const tierCounts = { a: 0, b: 0, c: 0 }
  for (const c of top30) tierCounts[c.tier as 'a' | 'b' | 'c']++
  console.log(`\nTier breakdown: 🔴 A=${tierCounts.a}  🟡 B=${tierCounts.b}  ⚪ C=${tierCounts.c}`)

  // ── Save to Supabase ──────────────────────────────────────────────────────
  let inserted = 0
  for (const c of top30) {
    const { error } = await supabase
      .from('trend_accounts')
      .upsert({
        username:               c.username,
        display_name:           c.displayName,
        followers_count:        c.followers,
        avg_reel_views:         c.avgViews,
        relevance_score:        c.score,
        is_active:              false,
        // v2
        median_reel_views:      c.medianViews,
        top3_avg_views:         c.top3Views,
        hit_rate_50k:           parseFloat(c.hitRate.toFixed(3)),
        virality_ratio:         parseFloat(c.viralityRatio.toFixed(2)),
        size_bucket:            c.bucket,
        source_clusters:        c.sourceClusters,
        sample_size:            c.sampleSize,
        business_model:         c.analysis.business_model_fit,
        why_matters:            c.analysis.why_matters,
        // v3
        top1_median_ratio:      c.stabilityRatio,
        stability_label:        c.stabilityLabel,
        confidence_score:       c.confidenceScore,
        freshness_score:        c.freshnessScore,
        matched_clusters_count: c.matchedClustersCount,
        format_copyability:     c.analysis.format_copyability,
        production_copyability: c.analysis.production_copyability,
        retail_copyability:     c.analysis.retail_copyability,
        tier:                   c.tier,
      }, { onConflict: 'username' })

    if (!error) inserted++
    else console.error(`  ✗ save @${c.username}:`, error.message)
  }

  console.log(`\n💾 Saved ${inserted} accounts to Supabase (is_active=false, tier assigned).`)
  console.log('   Tier A accounts are suggested for daily sync — activate at /accounts\n')
}

main().catch(e => { console.error(e); process.exit(1) })
