import { NextRequest, NextResponse } from 'next/server'
import { scrapeHashtagReels, scrapeProfile, type InstagramPost } from '@/lib/apify'
import { scoreAccountRelevance } from '@/lib/claude'

type Candidate = {
  username: string
  display_name: string | null
  followers_count: number
  avg_reel_views: number
  relevance_score: number
  category: string
  sample_reel_url: string | null
}

export async function POST(req: NextRequest) {
  const { hashtags } = await req.json() as { hashtags: string[] }
  if (!hashtags?.length) return NextResponse.json({ error: 'hashtags required' }, { status: 400 })

  const postsByAccount = new Map<string, InstagramPost[]>()

  for (const tag of hashtags.slice(0, 5)) {
    try {
      const posts = await scrapeHashtagReels(tag, 50)
      for (const post of posts) {
        if (!postsByAccount.has(post.ownerUsername)) {
          postsByAccount.set(post.ownerUsername, [])
        }
        postsByAccount.get(post.ownerUsername)!.push(post)
      }
    } catch (err) {
      console.error(`[discover] hashtag #${tag} failed:`, err)
    }
  }

  const candidates: Candidate[] = []

  for (const [username, posts] of postsByAccount.entries()) {
    try {
      const profile = await scrapeProfile(username)
      if (!profile) continue

      const followers = profile.followersCount
      if (followers < 2_000 || followers > 2_000_000) continue

      const views = posts.map(p => p.videoPlayCount ?? 0).filter(v => v > 0)
      const avgViews = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0

      const captions = posts.map(p => p.caption ?? '').filter(Boolean)

      const score = await scoreAccountRelevance({
        username,
        followersCount: followers,
        recentReelViews: views,
        sampleCaptions: captions,
      })

      candidates.push({
        username,
        display_name: profile.fullName,
        followers_count: followers,
        avg_reel_views: avgViews,
        relevance_score: score,
        category: 'wine_store',
        sample_reel_url: posts[0]?.url ?? null,
      })
    } catch (err) {
      console.error(`[discover] account @${username} failed:`, err)
    }
  }

  const sorted = candidates
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, 40)

  return NextResponse.json(sorted)
}
