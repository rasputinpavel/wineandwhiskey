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

// Same contract as requireEnv, for a value that may come from either of two
// legacy-named variables (BARRYMORE_OWNER_CHAT_ID preferred, BARRYMORE_CHAT_ID
// as a fallback) — exits unless at least one is set.
function requireAnyEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }
  console.error(
    `✗ None of ${names.join(' / ')} is set. In CI they come from GitHub secrets; locally from .env.local. ` +
    `Refusing to run — a silent no-op here went unnoticed for five months.`,
  )
  process.exit(1)
}

const SUPABASE_URL        = requireEnv('SUPABASE_URL')
const SUPABASE_KEY        = requireEnv('SUPABASE_SERVICE_KEY')
const APIFY_TOKEN         = requireEnv('APIFY_TOKEN')
// The digest is this script's only product. Without these, a run spends Apify
// credit, writes rows nobody reads, and still exits 0 — exactly as fatal as a
// missing APIFY_TOKEN, just further downstream.
const BARRYMORE_BOT_TOKEN = requireEnv('BARRYMORE_BOT_TOKEN')
const BARRYMORE_CHAT_ID   = requireAnyEnv(['BARRYMORE_OWNER_CHAT_ID', 'BARRYMORE_CHAT_ID'])

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
    // directUrls + resultsType=reels, ported from 02_services/trendwatch/lib/apify.ts:75.
    // The older `usernames` + `resultsType: 'posts'` input returns zero videos for most
    // accounts, which is why this job collected nothing even on the days it ran.
    body: JSON.stringify({
      directUrls:   [`https://www.instagram.com/${username}/reels/`],
      resultsType:  'reels',
      resultsLimit: maxPosts,
    }),
  })
  if (!res.ok) throw new Error(`Apify start failed: ${await res.text()}`)

  const { data: run } = await res.json() as { data: { id: string; defaultDatasetId: string } }

  const deadline = Date.now() + 5 * 60_000
  let succeeded = false
  while (Date.now() < deadline) {
    await sleep(10_000)
    const s = await fetch(`${BASE}/actor-runs/${run.id}`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } })
    const { data } = await s.json() as { data: { status: string } }
    if (data.status === 'SUCCEEDED') { succeeded = true; break }
    if (data.status === 'FAILED' || data.status === 'ABORTED') throw new Error(`Apify run ${data.status}`)
  }
  // Falling through here means the run was still RUNNING at the deadline — without
  // this throw we'd go fetch the dataset of a still-running actor and treat a
  // partial or empty result as complete, which reads in the log exactly like a
  // quiet account.
  if (!succeeded) throw new Error(`Apify run ${run.id} timed out after 5 minutes`)

  const d = await fetch(`${BASE}/datasets/${run.defaultDatasetId}/items?clean=true`, {
    headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
  })
  if (!d.ok) throw new Error(`Apify dataset fetch failed: ${await d.text()}`)
  const items = await d.json() as Post[]
  console.log(`  ${items.length} items from Apify, ${items.filter(p => p.videoPlayCount != null).length} with a view count`)
  return items.filter(p => p.videoPlayCount != null)
}

// BARRYMORE_BOT_TOKEN / BARRYMORE_CHAT_ID are required at module load (see
// requireEnv above), so this never has to report "not configured" — it just
// hands back the resolved pair.
function telegramTarget(): { token: string; chatId: string } {
  return { token: BARRYMORE_BOT_TOKEN, chatId: BARRYMORE_CHAT_ID }
}

async function sendDigest(reels: DigestReel[]): Promise<{ attempted: number; delivered: number } | null> {
  const fresh = reels.filter(r => isFreshForDigest(r.publishedAt))
  if (fresh.length === 0) {
    console.log(
      reels.length === 0
        ? '📭 No new reels — sending heartbeat instead'
        : `📭 ${reels.length} new reel(s), none published in the notify window — sending heartbeat instead`,
    )
    return null
  }

  const { token, chatId } = telegramTarget()
  const { photos, listed, omitted } = pickDigestReels(fresh)

  let attempted = 0
  let delivered = 0

  attempted++
  if (await sendMessage(token, chatId, formatHeader(fresh.length))) delivered++

  for (const reel of photos) {
    const caption = formatReelCaption(reel)
    attempted++
    let sent = reel.thumbnailUrl
      ? await sendPhotoFromUrl(token, chatId, reel.thumbnailUrl, caption)
      : false
    // No thumbnail, or Instagram refused it — the reel still deserves a message.
    // Deliberate trade: formatReelCaption budgets for Telegram's 1024-char photo
    // caption limit, so on this sendMessage fallback (4096-char limit) we leave
    // up to ~3000 chars of possible quote on the table. One string serves both
    // paths; the quote is a teaser, not the content — flagged in review. Note
    // this fallback does NOT help on a parse error (malformed HTML): the same
    // string is retried and fails the same way, which is why delivery is still
    // counted truthfully below rather than assumed.
    if (!sent) sent = await sendMessage(token, chatId, caption)
    if (sent) delivered++
  }

  if (listed.length > 0 || omitted > 0) {
    const tail = [...listed.map(formatListLine)]
    if (omitted > 0) tail.push(`…и ещё ${omitted} — порог прошли, в дайджест не влезли`)
    attempted++
    if (await sendMessage(token, chatId, tail.join('\n'))) delivered++
  }

  console.log(`📩 Digest: ${delivered}/${attempted} message(s) delivered (${photos.length} with thumbnails, ${listed.length} listed, ${omitted} omitted)`)
  return { attempted, delivered }
}

// A silent chat is ambiguous between "quiet day" and "the job never ran" —
// the same ambiguity that let a dead APIFY_TOKEN go unnoticed for five
// months. This line exists purely so the absence of a message means
// something: if it fails to send, the run must not claim success either
// (see the caller, which turns a false return into a failure).
async function sendHeartbeat(accountsChecked: number, reelsSeen: number): Promise<boolean> {
  const { token, chatId } = telegramTarget()
  const ok = await sendMessage(
    token, chatId,
    `🫧 Проверено аккаунтов: ${accountsChecked} · рилсов просмотрено: ${reelsSeen} · залётов нет`,
  )
  console.log(ok ? '🫧 Heartbeat sent' : '✗ Heartbeat failed to send')
  return ok
}

async function reportFailures(failures: Array<{ username: string; message: string }>, total: number): Promise<void> {
  const { token, chatId } = telegramTarget()
  const lines = [
    `⚠️ <b>Синк трендов упал: ${failures.length} из ${total} аккаунтов</b>`,
    ...failures.map(f => `• @${f.username} — ${f.message}`),
  ]
  await sendMessage(token, chatId, lines.join('\n'))
}

async function main() {
  const args = process.argv.slice(2)
  const forceAccount = args.find(a => a.startsWith('--account='))?.split('=')[1]
    || (args.includes('--account') ? args[args.indexOf('--account') + 1] : null)
  // A forced single account gets id: 'test', which is not a real uuid — it would
  // fail unchecked against the last_reel_at update. Forcing dry-run sidesteps
  // that write entirely instead of papering over it.
  const isDryRun = args.includes('--dry-run') || forceAccount !== null

  console.log(`\n📡 Trend sync ${isDryRun ? '[DRY RUN] ' : ''}started at ${new Date().toISOString()}\n`)
  if (forceAccount && !args.includes('--dry-run')) {
    console.log('  (--account forces --dry-run — nothing will be written)\n')
  }

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
    // This is the single most likely misconfiguration to recur — the table has
    // held exactly one irrelevant row for months without anyone noticing. Make
    // it loud instead of a quiet, successful no-op.
    console.error('✗ No active accounts in trend_accounts — nothing to scrape. Activate some with: npm run trends:accounts -- --on <username>')
    process.exitCode = 1
    return
  }

  console.log(`Monitoring ${accounts.length} account${accounts.length !== 1 ? 's' : ''}:\n`)

  const newReelNotifications: DigestReel[] = []
  const failures: Array<{ username: string; message: string }> = []
  let totalNew = 0
  let totalReelsSeen = 0

  for (const account of accounts) {
    console.log(`@${account.username}`)

    try {
      const posts = await scrapeAccount(account.username)
      totalReelsSeen += posts.length
      const followers = account.followers_count ?? 0
      const highReach = posts.filter(p => isHit(p.videoPlayCount ?? 0, followers))

      console.log(`  ${posts.length} Reels found, ${highReach.length} above threshold (≥5× подписчиков и ≥50K)`)

      for (const post of highReach) {
        const instagramId = post.shortCode
        const reelUrl      = post.url || `https://www.instagram.com/reel/${instagramId}/`
        const views        = post.videoPlayCount ?? 0

        const row = {
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
        }

        // Let the unique index on instagram_id decide. The old pattern asked first
        // with .single(), where a FAILED query is indistinguishable from "not seen
        // before" — so a broken connection (rotated key, RLS change, renamed
        // column) re-announced the same reels every morning instead of erroring.
        if (isDryRun) {
          const { data: existing, error } = await supabase
            .from('trend_reels')
            .select('id')
            .eq('instagram_id', instagramId)
            .maybeSingle()
          if (error) throw new Error(`lookup ${instagramId}: ${error.message}`)
          if (existing) continue
        } else {
          const { data: inserted, error } = await supabase
            .from('trend_reels')
            .upsert(row, { onConflict: 'instagram_id', ignoreDuplicates: true })
            .select('id')
          if (error) throw new Error(`insert ${instagramId}: ${error.message}`)
          if (!inserted?.length) continue   // we already had this one
        }

        console.log(`  + NEW: ${reelUrl} (${views.toLocaleString()} views)`)
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

  // Ten quiet wine accounts on the same morning is not a thing. Zero reels
  // across every account with no per-account errors means the scrape itself
  // is broken — most likely the Apify actor input (directUrls/resultsType)
  // has drifted again, the same way `usernames`+`posts` silently returned
  // nothing for five months. Make that loud instead of a clean "0 new reels".
  //
  // This is an aggregate-only heuristic and must not run on a dry run: ten
  // accounts at zero means the input drifted, but one quiet account means
  // nothing at all. `--account` is forced into --dry-run specifically so it
  // stays a useful one-off smoke test of the scrape path, not something that
  // reddens the run whenever that one account happens to be quiet.
  if (!isDryRun && failures.length === 0 && totalReelsSeen === 0) {
    failures.push({
      username: 'all-accounts',
      message: `zero reels across all ${accounts.length} account(s) — Apify input format has likely drifted again (see scrapeAccount)`,
    })
  }

  // Send what we have BEFORE failing: a non-zero exit must never cost us a
  // digest that is already assembled. Always attempt something on a real run
  // — a digest when there's fresh news, a heartbeat otherwise — per
  // sendHeartbeat's comment above: silence here is exactly the kind of gap
  // that let this job run broken for five months unnoticed.
  if (!isDryRun) {
    const digestResult = await sendDigest(newReelNotifications)
    if (digestResult === null) {
      const delivered = await sendHeartbeat(accounts.length, totalReelsSeen)
      if (!delivered) {
        failures.push({
          username: 'heartbeat',
          message: 'daily heartbeat failed to send — bot credentials or the Telegram API are likely broken',
        })
      }
    } else if (digestResult.delivered === 0) {
      failures.push({
        username: 'digest',
        message: `0 of ${digestResult.attempted} Telegram message(s) delivered — bot credentials or the Telegram API are likely broken`,
      })
    }
  }

  if (failures.length > 0) {
    if (!isDryRun) await reportFailures(failures, accounts.length)
    console.error(`\n✗ ${failures.length} of ${accounts.length} account(s) failed`)
    // process.exitCode (not process.exit) so stdout — including the per-account
    // "✗ Failed:" lines just logged — actually flushes before Node exits. In CI,
    // stdout is a pipe and writes to it are async; process.exit() does not wait
    // for pending writes, so the lines that matter most were the ones at risk
    // of being cut off.
    process.exitCode = 1
    return
  }

  console.log('✅ Done.')
}

main().catch(e => {
  console.error(e)
  process.exitCode = 1
})
