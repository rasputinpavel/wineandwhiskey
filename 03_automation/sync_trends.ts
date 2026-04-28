/**
 * sync_trends.ts
 * Daily sync: scrape active accounts, find high-reach Reels, save to Supabase, notify Barrymore.
 *
 * Usage:
 *   npm run trends
 *   npm run trends -- --dry-run
 *   npm run trends -- --account wineshopexample
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const APIFY_TOKEN = process.env.APIFY_TOKEN!
const BASE = 'https://api.apify.com/v2'
const VIEWS_ABSOLUTE  = 15_000  // catch niche accounts
const VIEWS_RELATIVE  = 1.5     // views/followers ratio

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type Post = {
  type: string
  shortCode: string
  ownerUsername: string
  videoPlayCount: number | null
  likesCount: number | null
  commentsCount: number | null
  caption: string | null
  hashtags: string[]
  displayUrl: string
  videoUrl: string | null
  videoDuration: number | null
  timestamp: string
  url: string
}

async function scrapeAccount(username: string, maxPosts = 30): Promise<Post[]> {
  const res = await fetch(`${BASE}/acts/apify~instagram-scraper/runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], resultsType: 'posts', resultsLimit: maxPosts }),
  })
  if (!res.ok) throw new Error(`Apify start failed: ${await res.text()}`)

  const { data: run } = await res.json() as { data: { id: string; defaultDatasetId: string } }

  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    await sleep(10_000)
    const s = await fetch(`${BASE}/actor-runs/${run.id}`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } })
    const { data } = await s.json() as { data: { status: string } }
    if (data.status === 'SUCCEEDED') break
    if (data.status === 'FAILED' || data.status === 'ABORTED') throw new Error(`Apify run ${data.status}`)
  }

  const d = await fetch(`${BASE}/datasets/${run.defaultDatasetId}/items?clean=true`, {
    headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
  })
  const items = await d.json() as Post[]
  return items.filter(p => p.type === 'Video')
}

async function notifyBarrymore(newReels: Array<{ username: string; views: number; url: string }>) {
  const token = process.env.BARRYMORE_BOT_TOKEN
  const chatId = process.env.BARRYMORE_OWNER_CHAT_ID ?? process.env.BARRYMORE_CHAT_ID
  const serviceUrl = process.env.TRENDWATCH_URL || 'https://trendwatch.railway.app'

  if (!token || !chatId || !newReels.length) return

  function fmt(n: number) {
    return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : String(n)
  }

  const lines = newReels.slice(0, 3).map((r, i) =>
    `${i + 1}. @${r.username} — <b>${fmt(r.views)} views</b>\n   <a href="${r.url}">смотреть рилс</a>`
  )

  const total = newReels.length
  const text = [
    `📈 <b>Новые тренды</b>: найдено ${total} рилс${total === 1 ? '' : 'ов'} >50K просмотров`,
    '',
    ...lines,
    '',
    `<a href="${serviceUrl}/discover">Открыть тренд-вотчинг →</a>`,
  ].join('\n')

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

async function main() {
  const args = process.argv.slice(2)
  const isDryRun = args.includes('--dry-run')
  const forceAccount = args.find(a => a.startsWith('--account='))?.split('=')[1]
    || (args.includes('--account') ? args[args.indexOf('--account') + 1] : null)

  console.log(`\n📡 Trend sync ${isDryRun ? '[DRY RUN] ' : ''}started at ${new Date().toISOString()}\n`)

  let accounts: Array<{ id: string; username: string; followers_count: number | null }>

  if (forceAccount) {
    accounts = [{ id: 'test', username: forceAccount, followers_count: null }]
  } else {
    const { data, error } = await supabase
      .from('trend_accounts')
      .select('id, username, followers_count')
      .eq('is_active', true)

    if (error) throw new Error(`Accounts fetch failed: ${error.message}`)
    accounts = data ?? []
  }

  if (!accounts.length) {
    console.log('No active accounts. Add and activate accounts at /accounts.')
    return
  }

  console.log(`Monitoring ${accounts.length} account${accounts.length !== 1 ? 's' : ''}:\n`)

  const newReelNotifications: Array<{ username: string; views: number; url: string }> = []
  let totalNew = 0

  for (const account of accounts) {
    console.log(`@${account.username}`)

    try {
      const posts = await scrapeAccount(account.username)
      const followers = account.followers_count ?? 0
      const highReach = posts.filter(p => {
        const v = p.videoPlayCount ?? 0
        const absoluteHit  = v >= VIEWS_ABSOLUTE
        const relativeHit  = followers > 0 && v / followers >= VIEWS_RELATIVE
        return absoluteHit || relativeHit
      })

      console.log(`  ${posts.length} Reels found, ${highReach.length} above threshold (≥${(VIEWS_ABSOLUTE/1000).toFixed(0)}K or ≥${VIEWS_RELATIVE}x ratio)`)

      for (const post of highReach) {
        const instagramId = post.shortCode

        const { data: existing } = await supabase
          .from('trend_reels')
          .select('id')
          .eq('instagram_id', instagramId)
          .single()

        if (existing) continue

        const reelUrl = post.url || `https://www.instagram.com/reel/${instagramId}/`

        if (!isDryRun) {
          await supabase.from('trend_reels').insert({
            account_id: account.id,
            instagram_id: instagramId,
            url: reelUrl,
            views_count: post.videoPlayCount ?? 0,
            likes_count: post.likesCount,
            comments_count: post.commentsCount,
            caption: post.caption,
            hashtags: post.hashtags,
            thumbnail_url: post.displayUrl,
            video_url: post.videoUrl,
            duration_s: post.videoDuration,
            published_at: post.timestamp,
            status: 'new',
          })
        }

        console.log(`  + NEW: ${reelUrl} (${(post.videoPlayCount ?? 0).toLocaleString()} views)`)
        newReelNotifications.push({
          username: account.username,
          views: post.videoPlayCount ?? 0,
          url: reelUrl,
        })
        totalNew++
      }

      if (!isDryRun && posts.length > 0) {
        await supabase
          .from('trend_accounts')
          .update({ last_reel_at: new Date().toISOString() })
          .eq('id', account.id)
      }
    } catch (err) {
      console.error(`  ✗ Failed:`, err)
    }

    await sleep(2000)
  }

  console.log(`\n✅ Done. New reels: ${totalNew}`)

  if (!isDryRun && newReelNotifications.length > 0) {
    await notifyBarrymore(newReelNotifications)
    console.log('📩 Barrymore notified')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
