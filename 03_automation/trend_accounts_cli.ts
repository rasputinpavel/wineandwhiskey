/**
 * trend_accounts_cli.ts — maintain the trend watchlist from the command line.
 *
 * The trendwatch web UI owned this job and is not deployed, so this is the only
 * way in. `is_active` is the single switch that costs money: only active
 * accounts are scraped by the daily sync.
 *
 * Usage:
 *   npm run trends:accounts -- --list
 *   npm run trends:accounts -- --add lucialoveswine marcelopinowine
 *   npm run trends:accounts -- --on fabiopicchiquintovizio vinoteca_mendoza
 *   npm run trends:accounts -- --off ingvildtennfjord
 *   npm run trends:accounts -- --refresh bodegagoulart_oficial
 *
 * --refresh is NOT free: it makes one Apify profile scrape per username to
 * re-read its current followers_count. Run it on accounts you suspect have
 * drifted, not as a routine sweep.
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { getProfile } from './lib/apify'
import { valuesAfter } from './lib/args'
import { multiple } from './lib/trends'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

type Account = {
  username:          string
  category:          string | null
  followers_count:   number | null
  median_reel_views: number | null
  top3_avg_views:    number | null
  tier:              string | null
  is_active:         boolean
}

async function list(): Promise<void> {
  const { data, error } = await supabase
    .from('trend_accounts')
    .select('username, category, followers_count, median_reel_views, top3_avg_views, tier, is_active')
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as Account[]
  rows.sort((a, b) =>
    multiple(b.top3_avg_views ?? 0, b.followers_count) - multiple(a.top3_avg_views ?? 0, a.followers_count))

  const active = rows.filter(r => r.is_active).length
  console.log(`\n${rows.length} account(s), ${active} active (only active ones are scraped daily)\n`)
  console.log('on   username                   followers   median    top3  mult  tier  category')
  console.log('-'.repeat(88))
  for (const r of rows) {
    const mult = multiple(r.top3_avg_views ?? 0, r.followers_count)
    console.log(
      `${r.is_active ? ' ✓  ' : '    '} ` +
      `${r.username.slice(0, 25).padEnd(25)} ` +
      `${String(r.followers_count ?? '—').padStart(9)} ` +
      `${String(r.median_reel_views ?? '—').padStart(8)} ` +
      `${String(r.top3_avg_views ?? '—').padStart(7)} ` +
      `${(mult >= 1 ? `${Math.round(mult)}x` : '—').padStart(5)} ` +
      `${(r.tier ?? '—').padStart(4)}  ${r.category ?? '—'}`,
    )
  }
  console.log()
}

/** Returns the number of usernames that failed, so main() can set the exit code. */
async function add(usernames: string[]): Promise<number> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_TOKEN is not set — needed to read the follower count')

  let failures = 0
  for (const raw of usernames) {
    const username = raw.replace(/^@/, '').trim()
    if (username === '') continue

    // One bad username — a network blip, a profile Apify can't resolve, an
    // unexpected throw from any step below — must not cost the rest of the
    // batch, especially after earlier usernames have already made paid calls
    // and been inserted.
    try {
      const { data: existing } = await supabase
        .from('trend_accounts')
        .select('username')
        .eq('username', username)
        .maybeSingle()
      if (existing) {
        console.log(`  = @${username} already in the list`)
        continue
      }

      // Fetch the profile once: without followers_count the multiple is 0 and the
      // account could never produce a digest entry.
      const profile = await getProfile(token, username)
      if (!profile) {
        console.error(`  ✗ @${username} — profile not found, skipped`)
        failures++
        continue
      }

      const { error } = await supabase.from('trend_accounts').insert({
        username,
        display_name:    profile.fullName,
        followers_count: profile.followersCount,
        category:        'manual',
        is_active:       false,
      })
      if (error) { console.error(`  ✗ @${username} — ${error.message}`); failures++ }
      else console.log(`  + @${username} (${profile.followersCount.toLocaleString()} followers), inactive`)
    } catch (err) {
      console.error(`  ✗ @${username} — ${err instanceof Error ? err.message : String(err)}`)
      failures++
    }
  }
  return failures
}

/** Returns the number of usernames that failed, so main() can set the exit code. */
async function setActive(usernames: string[], isActive: boolean): Promise<number> {
  let failures = 0
  for (const raw of usernames) {
    const username = raw.replace(/^@/, '').trim()
    if (username === '') continue
    // Same reasoning as add(): a thrown error from one username's update must
    // not abandon the rest of the --on/--off list.
    try {
      const { data, error } = await supabase
        .from('trend_accounts')
        .update({ is_active: isActive })
        .eq('username', username)
        .select('username')
      if (error) { console.error(`  ✗ @${username} — ${error.message}`); failures++ }
      else if (!data?.length) { console.error(`  ✗ @${username} — not in the list (add it first)`); failures++ }
      else console.log(`  ${isActive ? '✓ on ' : '· off'} @${username}`)
    } catch (err) {
      console.error(`  ✗ @${username} — ${err instanceof Error ? err.message : String(err)}`)
      failures++
    }
  }
  return failures
}

/** Returns the number of usernames that failed, so main() can set the exit code. */
async function refresh(usernames: string[]): Promise<number> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_TOKEN is not set — needed to read the follower count')

  let failures = 0
  for (const raw of usernames) {
    const username = raw.replace(/^@/, '').trim()
    if (username === '') continue

    // Same per-username isolation as add()/setActive(): one bad profile must
    // not abort the rest of the batch. The lookup happens before the paid
    // Apify call so a username that isn't tracked never costs money.
    try {
      const { data: existing, error: lookupError } = await supabase
        .from('trend_accounts')
        .select('username, followers_count')
        .eq('username', username)
        .maybeSingle()
      if (lookupError) { console.error(`  ✗ @${username} — ${lookupError.message}`); failures++; continue }
      if (!existing) {
        console.error(`  ✗ @${username} — not in the list (add it first)`)
        failures++
        continue
      }

      const profile = await getProfile(token, username)
      if (!profile) {
        // A handle that stopped resolving keeps its last known count rather
        // than being overwritten with null and becoming unusable.
        console.error(`  ✗ @${username} — profile not found, skipped`)
        failures++
        continue
      }

      const before = existing.followers_count as number | null
      const after = profile.followersCount

      const { error } = await supabase
        .from('trend_accounts')
        .update({
          followers_count: after,
          ...(profile.fullName ? { display_name: profile.fullName } : {}),
        })
        .eq('username', username)
      if (error) { console.error(`  ✗ @${username} — ${error.message}`); failures++; continue }

      if (before == null || before <= 0) {
        console.log(`  ↻ @${username} неизвестно → ${after.toLocaleString()}`)
      } else if (before === after) {
        console.log(`  ↻ @${username} ${after.toLocaleString()} (без изменений)`)
      } else {
        const pct = Math.round(((after - before) / before) * 100)
        console.log(`  ↻ @${username} ${before.toLocaleString()} → ${after.toLocaleString()} (${pct >= 0 ? '+' : ''}${pct}%)`)
      }
    } catch (err) {
      console.error(`  ✗ @${username} — ${err instanceof Error ? err.message : String(err)}`)
      failures++
    }
  }
  return failures
}

const USAGE = `Usage:
  npm run trends:accounts -- --list
  npm run trends:accounts -- --add lucialoveswine marcelopinowine
  npm run trends:accounts -- --on fabiopicchiquintovizio vinoteca_mendoza
  npm run trends:accounts -- --off ingvildtennfjord
  npm run trends:accounts -- --refresh bodegagoulart_oficial`

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--list')) {
    await list()
    return
  }

  const recognised = ['--add', '--on', '--off', '--refresh'].some(f => args.includes(f))
  if (!recognised) {
    console.error(`Unrecognised arguments: ${args.join(' ')}\n\n${USAGE}`)
    process.exitCode = 1
    return
  }

  let failures = 0
  if (args.includes('--add'))     failures += await add(valuesAfter(args, '--add'))
  if (args.includes('--on'))      failures += await setActive(valuesAfter(args, '--on'), true)
  if (args.includes('--off'))     failures += await setActive(valuesAfter(args, '--off'), false)
  if (args.includes('--refresh')) failures += await refresh(valuesAfter(args, '--refresh'))

  if (failures > 0) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exit(1) })
