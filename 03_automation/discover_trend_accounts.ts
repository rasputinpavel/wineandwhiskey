/**
 * discover_trend_accounts.ts — v2
 *
 * Improvements over v1:
 * - Hashtag clusters (retail / venue / style / authority / adjacent) with source tracking
 * - Robust metrics: median, p75, top-3, hit_rate instead of avg alone
 * - Size buckets (micro/small/mid/large) so small accounts compete fairly
 * - Claude returns structured JSON — debuggable, not a black-box score
 * - Minimum 3-reel sample guard before enriching a profile
 * - Composite score formula: median virality weighted most heavily
 *
 * Usage:
 *   npm run discover-accounts
 *   npm run discover-accounts -- --clusters=retail,venue
 *   npm run discover-accounts -- --hashtags=winestore,wineshop
 *
 * Requires migration 002_trend_accounts_v2.sql to be applied first.
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
  type: string
  shortCode: string
  ownerUsername: string
  ownerFullName: string | null
  videoPlayCount: number | null
  caption: string | null
  url: string
  timestamp: string
}

type Profile = {
  username: string
  fullName: string | null
  followersCount: number
  biography?: string
}

type AccountAnalysis = {
  business_model_fit: string
  content_format_strength: number
  retail_idea_density: number
  copyability_for_local_business: number
  red_flags: string[]
  why_matters: string
  verdict: 'keep' | 'maybe' | 'reject'
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
  if (followers < 10_000)  return 'micro'   // 2K–10K
  if (followers < 50_000)  return 'small'   // 10K–50K
  if (followers < 250_000) return 'mid'     // 50K–250K
  return 'large'                             // 250K–3M
}

// log-scale normaliser: ratio 200x → 1.0, 0x → 0
function logNorm(ratio: number): number {
  return Math.min(Math.log2(ratio + 1) / Math.log2(201), 1)
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
    const res  = await fetch(`${BASE}/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } })
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
  username:       string,
  followers:      number,
  medianViews:    number,
  top3Views:      number,
  hitRate:        number,
  medianRatio:    number,
  sourceClusters: string[],
  bio:            string,
  captions:       string[],
): Promise<AccountAnalysis> {
  const prompt =
    `You are scoring Instagram accounts as content inspiration sources for Wine & Whiskey — ` +
    `a wine & spirits retail store in Phuket targeting Russian-speaking customers.\n\n` +
    `Account: @${username}\n` +
    `Followers: ${followers.toLocaleString()}\n` +
    `Median Reel views: ${medianViews.toLocaleString()}\n` +
    `Top-3 avg views: ${top3Views.toLocaleString()}\n` +
    `Median views/followers ratio: ${medianRatio.toFixed(1)}x\n` +
    `Hit rate (reels >50K views): ${(hitRate * 100).toFixed(0)}%\n` +
    `Found via clusters: ${sourceClusters.join(', ')}\n` +
    `Bio: ${bio || '(none)'}\n` +
    `Sample captions: ${captions.slice(0, 2).join(' | ') || '(none)'}\n\n` +
    `Return ONLY valid JSON, no markdown:\n` +
    `{"business_model_fit":"wine_shop|wine_bar|media|creator|other",` +
    `"content_format_strength":1-5,` +
    `"retail_idea_density":1-5,` +
    `"copyability_for_local_business":1-5,` +
    `"red_flags":["..."],` +
    `"why_matters":"one specific sentence",` +
    `"verdict":"keep|maybe|reject"}`

  const res = await claude.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 250,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = res.content[0].type === 'text' ? res.content[0].text.trim() : '{}'
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim()) as AccountAnalysis
  } catch {
    return {
      business_model_fit:          'other',
      content_format_strength:     3,
      retail_idea_density:         3,
      copyability_for_local_business: 3,
      red_flags:                   [],
      why_matters:                 '',
      verdict:                     'maybe',
    }
  }
}

function computeScore(
  medianRatio: number,
  p75Ratio:    number,
  top1Ratio:   number,
  hitRate:     number,
  analysis:    AccountAnalysis,
): number {
  const raw =
    0.25 * logNorm(medianRatio) +
    0.20 * logNorm(p75Ratio) +
    0.15 * logNorm(top1Ratio) +
    0.15 * hitRate +
    0.15 * (analysis.copyability_for_local_business / 5) +
    0.10 * (analysis.retail_idea_density / 5)
  return Math.round(raw * 9 + 1) // 0–1 → 1–10
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)

  const clusterArg  = args.find(a => a.startsWith('--clusters='))?.split('=')[1]
  const hashtagArg  = args.find(a => a.startsWith('--hashtags='))?.split('=')[1]

  // Build hashtag list + cluster map
  let clusterMap: Map<string, string>   // hashtag → cluster name
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

  // ── Collect posts by account ──────────────────────────────────────────────
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
    username:       string
    displayName:    string | null
    followers:      number
    bucket:         string
    sourceClusters: string[]
    sampleSize:     number
    avgViews:       number
    medianViews:    number
    top3Views:      number
    hitRate:        number
    viralityRatio:  number
    score:          number
    analysis:       AccountAnalysis
    sampleUrl:      string
  }

  const candidates: Candidate[] = []

  for (const [username, posts] of postsByAccount.entries()) {
    try {
      process.stdout.write(`  @${username}… `)

      // Minimum sample guard
      const views = posts.map(p => p.videoPlayCount ?? 0).filter(v => v > 0)
      if (views.length < 3) {
        console.log(`skip (only ${views.length} reels sampled — need ≥3)`)
        continue
      }

      const profile = await getProfile(username)
      if (!profile) { console.log('no profile'); continue }

      const followers = profile.followersCount ?? 0
      if (followers < 2_000 || followers > 3_000_000) {
        console.log(`skip (${followers.toLocaleString()} followers)`)
        continue
      }

      // Robust metrics
      const avgViews    = Math.round(views.reduce((a, b) => a + b, 0) / views.length)
      const medianViews = Math.round(median(views))
      const p75Views    = Math.round(p75(views))
      const top3Views   = top3Avg(views)
      const hitRate     = views.filter(v => v >= 50_000).length / views.length
      const medianRatio = followers > 0 ? medianViews / followers : 0
      const p75Ratio    = followers > 0 ? p75Views    / followers : 0
      const top1Ratio   = followers > 0 ? Math.max(...views) / followers : 0

      const sourceClusters = [...(clustersByAccount.get(username) ?? [])]
      const captions       = posts.map(p => p.caption ?? '').filter(Boolean)
      const bio            = profile.biography ?? ''
      const bucket         = sizeBucket(followers)

      const analysis = await analyzeAccount(
        username, followers, medianViews, top3Views, hitRate,
        medianRatio, sourceClusters, bio, captions,
      )

      if (analysis.verdict === 'reject') {
        console.log(`reject — ${analysis.red_flags.join(', ')}`)
        continue
      }

      const score = computeScore(medianRatio, p75Ratio, top1Ratio, hitRate, analysis)

      console.log(
        `${bucket.padEnd(6)} | med=${medianViews.toLocaleString()} ratio=${medianRatio.toFixed(1)}x ` +
        `hit=${(hitRate * 100).toFixed(0)}% ${analysis.verdict} ${score}/10` +
        (analysis.why_matters ? ` | ${analysis.why_matters.slice(0, 55)}` : '')
      )

      candidates.push({
        username, displayName: profile.fullName, followers, bucket, sourceClusters,
        sampleSize: views.length, avgViews, medianViews, top3Views, hitRate,
        viralityRatio: medianRatio, score, analysis, sampleUrl: posts[0]?.url ?? '',
      })
    } catch (err) {
      console.error(`  ✗ @${username}:`, err)
    }
    await sleep(1000)
  }

  // ── Rank within size buckets, then blend top 30 ───────────────────────────
  const PER_BUCKET = 8
  const ranked: Candidate[] = []
  for (const b of ['micro', 'small', 'mid', 'large']) {
    const inBucket = candidates.filter(c => c.bucket === b).sort((a, z) => z.score - a.score)
    ranked.push(...inBucket.slice(0, PER_BUCKET))
  }
  ranked.sort((a, z) => z.score - a.score)
  const top30 = ranked.slice(0, 30)

  console.log(`\n✅ Top ${top30.length} candidates:\n`)
  for (const c of top30) {
    console.log(
      `  [${c.score}/10] ${c.bucket.padEnd(6)} @${c.username.padEnd(32)} ` +
      `${String(c.followers).padStart(7)} flw · med ${String(c.medianViews).padStart(7)} · ` +
      `hit ${(c.hitRate * 100).toFixed(0).padStart(3)}% · ${(c.analysis.why_matters ?? '').slice(0, 50)}`
    )
  }

  // ── Save to Supabase ──────────────────────────────────────────────────────
  let inserted = 0
  for (const c of top30) {
    const { error } = await supabase
      .from('trend_accounts')
      .upsert({
        username:          c.username,
        display_name:      c.displayName,
        followers_count:   c.followers,
        avg_reel_views:    c.avgViews,
        relevance_score:   c.score,
        is_active:         false,
        // v2 fields (migration 002)
        median_reel_views: c.medianViews,
        top3_avg_views:    c.top3Views,
        hit_rate_50k:      parseFloat(c.hitRate.toFixed(3)),
        virality_ratio:    parseFloat(c.viralityRatio.toFixed(2)),
        size_bucket:       c.bucket,
        source_clusters:   c.sourceClusters,
        sample_size:       c.sampleSize,
        business_model:    c.analysis.business_model_fit,
        why_matters:       c.analysis.why_matters,
      }, { onConflict: 'username' })

    if (!error) inserted++
    else console.error(`  ✗ save @${c.username}:`, error.message)
  }

  console.log(`\n💾 Saved ${inserted} accounts to Supabase (is_active=false).`)
  console.log('   Review and activate them at: /accounts\n')
}

main().catch(e => { console.error(e); process.exit(1) })
