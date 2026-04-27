/**
 * discover_trend_accounts.ts
 * One-time script to find wine/spirits Instagram accounts worth monitoring.
 *
 * Usage:
 *   npm run discover-accounts
 *   npm run discover-accounts -- --hashtags "winestore,wineshop,sommelier"
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const APIFY_TOKEN = process.env.APIFY_TOKEN!
const BASE = 'https://api.apify.com/v2'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const DEFAULT_HASHTAGS = [
  'winestore', 'wineshop', 'winebar', 'sommelier',
  'naturalwine', 'wineretail', 'finewine', 'whiskybar', 'winelovers',
]

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
}

async function runApify(actorId: string, input: Record<string, unknown>): Promise<{ runId: string; datasetId: string }> {
  const res = await fetch(`${BASE}/acts/${actorId}/runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Apify start failed: ${await res.text()}`)
  const { data } = await res.json() as { data: { id: string; defaultDatasetId: string } }
  return { runId: data.id, datasetId: data.defaultDatasetId }
}

async function pollApify(runId: string, maxMs = 300_000): Promise<void> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    await sleep(10_000)
    const res = await fetch(`${BASE}/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } })
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
  const { runId, datasetId } = await runApify('apify/instagram-hashtag-scraper', {
    hashtags: [hashtag],
    resultsLimit: 60,
  })
  await pollApify(runId)
  const items = await getDataset<Post>(datasetId)
  return items.filter(p => p.type === 'Video')
}

async function getProfile(username: string): Promise<Profile | null> {
  const { runId, datasetId } = await runApify('apify/instagram-profile-scraper', {
    usernames: [username],
  })
  await pollApify(runId, 60_000)
  const items = await getDataset<Profile>(datasetId)
  return items[0] ?? null
}

async function scoreRelevance(
  username: string,
  followers: number,
  avgViews: number,
  captions: string[]
): Promise<number> {
  const res = await claude.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10,
    messages: [{
      role: 'user',
      content: `Rate this Instagram account 1-10 for relevance as a wine/spirits content source.
@${username} | Followers: ${followers.toLocaleString()} | Avg Reel views: ${avgViews.toLocaleString()}
Captions: ${captions.slice(0, 2).join(' | ')}
Criteria: wine/spirits focused, posts Reels regularly, good engagement.
Reply with ONLY an integer 1-10.`,
    }],
  })
  const text = res.content[0].type === 'text' ? res.content[0].text.trim() : '5'
  return Math.max(1, Math.min(10, parseInt(text) || 5))
}

async function main() {
  const args = process.argv.slice(2)
  const hashtagArg = args.find(a => a.startsWith('--hashtags='))?.split('=')[1]
  const hashtags = hashtagArg
    ? hashtagArg.split(',').map(t => t.trim().replace(/^#/, ''))
    : DEFAULT_HASHTAGS

  console.log(`\n🔍 Discovering accounts from ${hashtags.length} hashtags: ${hashtags.join(', ')}\n`)

  // Collect posts by account
  const postsByAccount = new Map<string, Post[]>()

  for (const tag of hashtags) {
    try {
      const posts = await scrapeHashtag(tag)
      console.log(`  → ${posts.length} Reels from #${tag}`)

      for (const post of posts) {
        if (!postsByAccount.has(post.ownerUsername)) {
          postsByAccount.set(post.ownerUsername, [])
        }
        postsByAccount.get(post.ownerUsername)!.push(post)
      }
    } catch (err) {
      console.error(`  ✗ #${tag} failed:`, err)
    }
    await sleep(2000)
  }

  console.log(`\n📊 Found ${postsByAccount.size} unique accounts. Enriching profiles…\n`)

  type Candidate = {
    username: string
    displayName: string | null
    followers: number
    avgViews: number
    score: number
    sampleUrl: string
  }

  const candidates: Candidate[] = []

  for (const [username, posts] of postsByAccount.entries()) {
    try {
      process.stdout.write(`  @${username}… `)

      const profile = await getProfile(username)
      if (!profile) { console.log('no profile'); continue }

      const followers = profile.followersCount
      if (followers < 2_000 || followers > 3_000_000) {
        console.log(`skip (${followers.toLocaleString()} followers)`)
        continue
      }

      const views = posts.map(p => p.videoPlayCount ?? 0).filter(v => v > 0)
      const avgViews = views.length
        ? Math.round(views.reduce((a, b) => a + b, 0) / views.length)
        : 0

      const captions = posts.map(p => p.caption ?? '').filter(Boolean)
      const score = await scoreRelevance(username, followers, avgViews, captions)

      console.log(`followers=${followers.toLocaleString()} avgViews=${avgViews.toLocaleString()} score=${score}/10`)

      candidates.push({
        username,
        displayName: profile.fullName,
        followers,
        avgViews,
        score,
        sampleUrl: posts[0]?.url ?? '',
      })
    } catch (err) {
      console.error(`  ✗ @${username}:`, err)
    }

    await sleep(1000)
  }

  // Sort by score desc
  candidates.sort((a, b) => b.score - a.score)
  const top30 = candidates.slice(0, 30)

  console.log(`\n✅ Top ${top30.length} candidates:\n`)
  for (const c of top30) {
    console.log(
      `  [${c.score}/10] @${c.username.padEnd(30)} ${String(c.followers).padStart(8)} followers · ${String(c.avgViews).padStart(8)} avg views`
    )
  }

  // Insert into Supabase (is_active=false — user reviews in UI)
  let inserted = 0
  for (const c of top30) {
    const { error } = await supabase
      .from('trend_accounts')
      .upsert({
        username: c.username,
        display_name: c.displayName,
        followers_count: c.followers,
        avg_reel_views: c.avgViews,
        relevance_score: c.score,
        is_active: false,
      }, { onConflict: 'username' })

    if (!error) inserted++
  }

  console.log(`\n💾 Saved ${inserted} accounts to Supabase (is_active=false).`)
  console.log('   Review and activate them at: /accounts\n')
}

main().catch(e => { console.error(e); process.exit(1) })
