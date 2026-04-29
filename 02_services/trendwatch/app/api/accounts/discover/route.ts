import { NextRequest } from 'next/server'
import { scrapeHashtagReels, scrapeProfile, type InstagramPost } from '@/lib/apify'
import { scoreAccountRelevance } from '@/lib/claude'

export const runtime = 'nodejs'
export const maxDuration = 600

type Candidate = {
  username:        string
  display_name:    string | null
  followers_count: number
  avg_reel_views:  number
  relevance_score: number
  category:        string
  sample_reel_url: string | null
}

export async function POST(req: NextRequest) {
  const { hashtags } = await req.json() as { hashtags: string[] }
  if (!hashtags?.length) {
    return new Response(JSON.stringify({ error: 'hashtags required' }), { status: 400 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const emit = (obj: object) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))

      // Heartbeat keeps the stream alive through Apify's long polls (Railway/proxy
      // can drop idle connections). Emits every 3s while work is in progress.
      const heartbeat = setInterval(() => emit({ type: 'heartbeat', t: Date.now() }), 3000)

      const tags = hashtags.slice(0, 20)
      emit({ type: 'log', message: `🔍 Запускаю поиск по ${tags.length} хэштегам — каждый занимает ~30–90 сек на Apify, всего ~${Math.round(tags.length * 0.7)} мин...` })

      const postsByAccount = new Map<string, InstagramPost[]>()

      for (let i = 0; i < tags.length; i++) {
        const tag = tags[i]
        emit({ type: 'phase', phase: 'hashtag', current: i + 1, total: tags.length, label: `#${tag}` })
        emit({ type: 'log', message: `  → Сканирую #${tag}...` })
        try {
          const posts = await scrapeHashtagReels(tag, 50)
          emit({ type: 'log', message: `  ← #${tag}: найдено ${posts.length} Reels` })
          for (const post of posts) {
            if (!postsByAccount.has(post.ownerUsername)) postsByAccount.set(post.ownerUsername, [])
            postsByAccount.get(post.ownerUsername)!.push(post)
          }
        } catch (err) {
          emit({ type: 'log', message: `  ✗ #${tag} — ошибка: ${(err as Error).message}` })
        }
      }

      const accounts = [...postsByAccount.entries()]
      emit({ type: 'log', message: `📊 Уникальных аккаунтов: ${accounts.length}. Обогащаю профили...` })

      const candidates: Candidate[] = []

      for (let i = 0; i < accounts.length; i++) {
        const [username, posts] = accounts[i]
        emit({ type: 'phase', phase: 'account', current: i + 1, total: accounts.length, label: `@${username}` })

        try {
          const profile = await scrapeProfile(username)
          if (!profile) { emit({ type: 'log', message: `  · @${username} — профиль не найден` }); continue }

          const followers = profile.followersCount
          if (followers < 2_000 || followers > 2_000_000) {
            emit({ type: 'log', message: `  · @${username} — пропуск (${followers.toLocaleString()} фолловеров)` })
            continue
          }

          const views    = posts.map(p => p.videoPlayCount ?? 0).filter(v => v > 0)
          const avgViews = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0
          const captions = posts.map(p => p.caption ?? '').filter(Boolean)

          const score = await scoreAccountRelevance({
            username,
            followersCount:  followers,
            recentReelViews: views,
            sampleCaptions:  captions,
          })

          const candidate: Candidate = {
            username,
            display_name:    profile.fullName,
            followers_count: followers,
            avg_reel_views:  avgViews,
            relevance_score: score,
            category:        'wine_store',
            sample_reel_url: posts[0]?.url ?? null,
          }
          candidates.push(candidate)

          emit({
            type: 'log',
            message: `  ✓ @${username} — ${followers.toLocaleString()} flw · ${avgViews.toLocaleString()} avg · ${score}/10`,
          })
          emit({ type: 'candidate', candidate })
        } catch (err) {
          emit({ type: 'log', message: `  ✗ @${username} — ошибка: ${(err as Error).message}` })
        }
      }

      const sorted = candidates.sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 40)
      emit({ type: 'log', message: `✅ Готово — ${sorted.length} кандидатов` })
      emit({ type: 'done', candidates: sorted })
      clearInterval(heartbeat)
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':       'application/x-ndjson; charset=utf-8',
      'Cache-Control':      'no-cache, no-transform',
      'X-Accel-Buffering':  'no',
    },
  })
}
