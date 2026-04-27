import { supabase } from '@/lib/supabase'
import Shell from '@/components/Shell'
import Link from 'next/link'

const STATUS_COLOR: Record<string, string> = {
  new: 'bg-gray-700 text-gray-200',
  analyzing: 'bg-blue-900 text-blue-300',
  analyzed: 'bg-yellow-900 text-yellow-300',
  approved: 'bg-green-900 text-green-300',
  skipped: 'bg-gray-800 text-gray-500',
  briefed: 'bg-purple-900 text-purple-300',
  published: 'bg-indigo-900 text-indigo-300',
}

const STATUS_TABS = ['all', 'new', 'analyzed', 'approved', 'briefed', 'published', 'skipped']

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const activeStatus = status && STATUS_TABS.includes(status) ? status : 'all'

  let query = supabase
    .from('trend_reels')
    .select('id, status, views_count, likes_count, thumbnail_url, caption, discovered_at, trend_accounts(username, display_name)')
    .order('views_count', { ascending: false })
    .limit(60)

  if (activeStatus !== 'all') query = query.eq('status', activeStatus)

  const { data: reels } = await query

  return (
    <Shell>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Discover</h1>
          <form action="/api/reels/sync" method="POST">
            <button
              type="submit"
              className="px-4 py-2 bg-wine-700 hover:bg-wine-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Sync accounts
            </button>
          </form>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {STATUS_TABS.map(s => (
            <Link
              key={s}
              href={s === 'all' ? '/discover' : `/discover?status=${s}`}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                activeStatus === s
                  ? 'bg-wine-700 text-white font-medium'
                  : 'bg-gray-900 text-gray-400 hover:text-white border border-gray-800 hover:border-gray-600'
              }`}
            >
              {s}
            </Link>
          ))}
        </div>

        {/* Reels grid */}
        {!reels?.length ? (
          <div className="text-center py-20 text-gray-500">
            No reels found. Add accounts and run a sync.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-5">
            {reels.map(reel => {
              const account = (reel.trend_accounts as { username: string } | null)?.username
              return (
                <Link
                  key={reel.id}
                  href={`/discover/${reel.id}`}
                  className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-600 transition-colors group"
                >
                  {/* Thumbnail */}
                  <div className="aspect-[9/6] bg-gray-800 relative overflow-hidden">
                    {reel.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={reel.thumbnail_url}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600 text-3xl">▶</div>
                    )}
                    <div className="absolute top-2 right-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[reel.status]}`}>
                        {reel.status}
                      </span>
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-gray-400 text-xs">@{account}</span>
                      <span className="text-white font-bold">{fmt(reel.views_count)}</span>
                    </div>
                    {reel.caption && (
                      <p className="text-gray-500 text-xs line-clamp-2">{reel.caption}</p>
                    )}
                    <div className="mt-2 text-gray-600 text-xs">
                      {reel.likes_count ? `${fmt(reel.likes_count)} likes` : ''}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </Shell>
  )
}
