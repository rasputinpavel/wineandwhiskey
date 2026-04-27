import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { scrapeAccountReels } from '@/lib/apify'

const VIEWS_THRESHOLD = 50_000

export async function POST() {
  const { data: accounts, error } = await supabase
    .from('trend_accounts')
    .select('id, username')
    .eq('is_active', true)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!accounts?.length) return NextResponse.json({ message: 'No active accounts', synced: 0 })

  let totalNew = 0

  for (const account of accounts) {
    try {
      const posts = await scrapeAccountReels(account.username, 30)
      const highReach = posts.filter(p => (p.videoPlayCount ?? 0) >= VIEWS_THRESHOLD)

      for (const post of highReach) {
        const instagramId = post.shortCode
        const { data: existing } = await supabase
          .from('trend_reels')
          .select('id')
          .eq('instagram_id', instagramId)
          .single()

        if (existing) continue

        await supabase.from('trend_reels').insert({
          account_id: account.id,
          instagram_id: instagramId,
          url: post.url || `https://www.instagram.com/reel/${instagramId}/`,
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

        totalNew++
      }

      // Update last_reel_at
      if (posts.length > 0) {
        await supabase
          .from('trend_accounts')
          .update({ last_reel_at: new Date().toISOString() })
          .eq('id', account.id)
      }
    } catch (err) {
      console.error(`[sync] failed for @${account.username}:`, err)
    }
  }

  return NextResponse.json({ synced: totalNew, accounts: accounts.length })
}
