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
import {
  isFreshForDigest,
  isHit,
  multiple,
  formatHeader,
  formatListLine,
  formatReelCaption,
  pickDigestReels,
  type DigestReel,
} from './lib/trends'
import { sendMessage, sendPhotoFromUrl } from './lib/telegram'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(
      `✗ ${name} is not set. In CI it comes from a GitHub secret; locally from .env.local. ` +
      `Refusing to run — a silent no-op here went unnoticed for five months.`,
    )
    process.exit(1)
  }
  return value
}

const SUPABASE_URL  = requireEnv('SUPABASE_URL')
const SUPABASE_KEY  = requireEnv('SUPABASE_SERVICE_KEY')
const APIFY_TOKEN   = requireEnv('APIFY_TOKEN')

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const BASE = 'https://api.apify.com/v2'

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

async function scrapeAccount(username: string, maxPosts = 10): Promise<Post[]> {
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

function telegramTarget(): { token: string; chatId: string } | null {
  const token  = process.env.BARRYMORE_BOT_TOKEN
  const chatId = process.env.BARRYMORE_OWNER_CHAT_ID ?? process.env.BARRYMORE_CHAT_ID
  if (!token || !chatId) {
    console.error('  ⚠ BARRYMORE_BOT_TOKEN / BARRYMORE_CHAT_ID not set — digest not sent')
    return null
  }
  return { token, chatId }
}

async function sendDigest(reels: DigestReel[]): Promise<void> {
  const fresh = reels.filter(r => isFreshForDigest(r.publishedAt))
  if (fresh.length === 0) {
    console.log(`📭 ${reels.length} new reel(s), none published in the notify window — no digest`)
    return
  }

  const target = telegramTarget()
  if (!target) return
  const { token, chatId } = target

  const { photos, listed, omitted } = pickDigestReels(fresh)

  await sendMessage(token, chatId, formatHeader(fresh.length))

  for (const reel of photos) {
    const caption = formatReelCaption(reel)
    const sent = reel.thumbnailUrl
      ? await sendPhotoFromUrl(token, chatId, reel.thumbnailUrl, caption)
      : false
    // No thumbnail, or Instagram refused it — the reel still deserves a message.
    // Deliberate trade: formatReelCaption budgets for Telegram's 1024-char photo
    // caption limit, so on this sendMessage fallback (4096-char limit) we leave
    // up to ~3000 chars of possible quote on the table. One string serves both
    // paths; the quote is a teaser, not the content — flagged in review.
    if (!sent) await sendMessage(token, chatId, caption)
  }

  if (listed.length > 0 || omitted > 0) {
    const tail = [...listed.map(formatListLine)]
    if (omitted > 0) tail.push(`…и ещё ${omitted} — порог прошли, в дайджест не влезли`)
    await sendMessage(token, chatId, tail.join('\n'))
  }

  console.log(`📩 Digest sent: ${photos.length} with thumbnails, ${listed.length} listed, ${omitted} omitted`)
}

async function reportFailures(failures: Array<{ username: string; message: string }>, total: number): Promise<void> {
  const target = telegramTarget()
  if (!target) return
  const lines = [
    `⚠️ <b>Синк трендов упал: ${failures.length} из ${total} аккаунтов</b>`,
    ...failures.map(f => `• @${f.username} — ${f.message}`),
  ]
  await sendMessage(target.token, target.chatId, lines.join('\n'))
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

  const newReelNotifications: DigestReel[] = []
  const failures: Array<{ username: string; message: string }> = []
  let totalNew = 0

  for (const account of accounts) {
    console.log(`@${account.username}`)

    try {
      const posts = await scrapeAccount(account.username)
      const followers = account.followers_count ?? 0
      const highReach = posts.filter(p => isHit(p.videoPlayCount ?? 0, followers))

      console.log(`  ${posts.length} Reels found, ${highReach.length} above threshold (≥5× подписчиков и ≥50K)`)

      for (const post of highReach) {
        const instagramId = post.shortCode

        const { data: existing } = await supabase
          .from('trend_reels')
          .select('id')
          .eq('instagram_id', instagramId)
          .single()

        if (existing) continue

        const reelUrl     = post.url || `https://www.instagram.com/reel/${instagramId}/`
        const views       = post.videoPlayCount ?? 0

        if (!isDryRun) {
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
            trigger_type:         'both',
            views_at_capture:     views,
            followers_at_capture: followers,
            ratio_at_capture:     followers > 0 ? parseFloat(multiple(views, followers).toFixed(2)) : null,
          })
        }

        console.log(`  + NEW: ${reelUrl} (${(post.videoPlayCount ?? 0).toLocaleString()} views)`)
        newReelNotifications.push({
          username:     account.username,
          views:        post.videoPlayCount ?? 0,
          followers,
          url:          reelUrl,
          publishedAt:  post.timestamp ?? null,
          durationS:    post.videoDuration ?? null,
          caption:      post.caption ?? null,
          thumbnailUrl: post.displayUrl ?? null,
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
      const message = err instanceof Error ? err.message : String(err)
      console.error(`  ✗ Failed: ${message}`)
      failures.push({ username: account.username, message })
    }

    await sleep(2000)
  }

  console.log(`\nNew reels: ${totalNew}`)

  // Send what we have BEFORE failing: a non-zero exit must never cost us a
  // digest that is already assembled.
  if (!isDryRun && newReelNotifications.length > 0) {
    await sendDigest(newReelNotifications)
  }

  if (failures.length > 0) {
    if (!isDryRun) await reportFailures(failures, accounts.length)
    console.error(`\n✗ ${failures.length} of ${accounts.length} account(s) failed`)
    process.exit(1)
  }

  console.log('✅ Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
