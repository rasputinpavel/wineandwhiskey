import { supabase } from '@/lib/supabase'
import Shell from '@/components/Shell'
import Link from 'next/link'

function fmt(n: number | null) {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function ratio(ours: number | null, source: number | null): string {
  if (!ours || !source) return '—'
  const r = ours / source
  const color = r >= 0.5 ? 'text-green-400' : r >= 0.2 ? 'text-yellow-400' : 'text-red-400'
  return `${Math.round(r * 100)}%`
}

export default async function TrackPage() {
  const { data: ourReels } = await supabase
    .from('trend_our_reels')
    .select('*, trend_reels(views_count, thumbnail_url, url, trend_accounts(username))')
    .order('published_at', { ascending: false })

  return (
    <Shell>
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-white">Track</h1>
          <p className="text-gray-400 text-sm">Compare our reels against the source</p>
        </div>

        {!ourReels?.length ? (
          <div className="text-center py-20">
            <p className="text-gray-500 mb-4">No published reels yet.</p>
            <Link href="/discover" className="text-wine-500 hover:underline text-sm">
              Go to Discover →
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {ourReels.map(row => {
              const source = row.trend_reels as { views_count: number; thumbnail_url: string | null; url: string | null; trend_accounts: { username: string } | null } | null

              return (
                <div key={row.id} className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                  <div className="flex items-start gap-6">
                    {source?.thumbnail_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={source.thumbnail_url}
                        alt=""
                        className="w-20 h-20 object-cover rounded-lg flex-shrink-0"
                      />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-3">
                        {source?.trend_accounts?.username && (
                          <span className="text-gray-400 text-sm">@{source.trend_accounts.username}</span>
                        )}
                        {source?.url && (
                          <a href={source.url} target="_blank" rel="noreferrer" className="text-gray-500 text-xs hover:text-gray-300">
                            source ↗
                          </a>
                        )}
                        {row.instagram_url && (
                          <a href={row.instagram_url} target="_blank" rel="noreferrer" className="text-gray-500 text-xs hover:text-gray-300">
                            our reel ↗
                          </a>
                        )}
                      </div>

                      {/* Metrics comparison */}
                      <div className="grid grid-cols-5 gap-4">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Source views</div>
                          <div className="text-white font-semibold">{fmt(source?.views_count ?? null)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Our 7d</div>
                          <div className="text-white font-semibold">{fmt(row.views_7d)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Our 14d</div>
                          <div className="text-white font-semibold">{fmt(row.views_14d)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Our 30d</div>
                          <div className="text-white font-semibold">{fmt(row.views_30d)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Followers gained</div>
                          <div className="text-white font-semibold">{fmt(row.followers_gained)}</div>
                        </div>
                      </div>

                      {row.notes && (
                        <p className="text-gray-500 text-xs mt-3">{row.notes}</p>
                      )}
                    </div>

                    <Link
                      href={`/track/${row.id}/update`}
                      className="flex-shrink-0 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors"
                    >
                      Update metrics
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Shell>
  )
}
