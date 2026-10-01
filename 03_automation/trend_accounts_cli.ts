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
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { getProfile } from './lib/apify'
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

async function add(usernames: string[]): Promise<void> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_TOKEN is not set — needed to read the follower count')

  for (const raw of usernames) {
    const username = raw.replace(/^@/, '').trim()
    if (username === '') continue

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
      continue
    }

    const { error } = await supabase.from('trend_accounts').insert({
      username,
      display_name:    profile.fullName,
      followers_count: profile.followersCount,
      category:        'manual',
      is_active:       false,
    })
    if (error) console.error(`  ✗ @${username} — ${error.message}`)
    else console.log(`  + @${username} (${profile.followersCount.toLocaleString()} followers), inactive`)
  }
}

async function setActive(usernames: string[], isActive: boolean): Promise<void> {
  for (const raw of usernames) {
    const username = raw.replace(/^@/, '').trim()
    if (username === '') continue
    const { data, error } = await supabase
      .from('trend_accounts')
      .update({ is_active: isActive })
      .eq('username', username)
      .select('username')
    if (error) console.error(`  ✗ @${username} — ${error.message}`)
    else if (!data?.length) console.error(`  ✗ @${username} — not in the list (add it first)`)
    else console.log(`  ${isActive ? '✓ on ' : '· off'} @${username}`)
  }
}

function valuesAfter(args: string[], flag: string): string[] {
  const i = args.indexOf(flag)
  if (i === -1) return []
  return args.slice(i + 1).filter(a => !a.startsWith('--'))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--list') || args.length === 0) {
    await list()
    return
  }
  if (args.includes('--add'))  await add(valuesAfter(args, '--add'))
  if (args.includes('--on'))   await setActive(valuesAfter(args, '--on'), true)
  if (args.includes('--off'))  await setActive(valuesAfter(args, '--off'), false)
}

main().catch(e => { console.error(e); process.exit(1) })
