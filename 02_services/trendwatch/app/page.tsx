import { supabase } from '@/lib/supabase'
import Shell from '@/components/Shell'
import Link from 'next/link'

// Read-from-DB on every request — otherwise Next.js statically renders this at
// build time on Railway, when the DB was empty, and the dashboard stays stuck
// at zero counts forever.
export const dynamic  = 'force-dynamic'
export const revalidate = 0

const STATUS_ORDER = ['new', 'analyzing', 'analyzed', 'approved', 'skipped', 'briefed', 'published']
const STATUS_COLOR: Record<string, string> = {
  new: 'bg-gray-700 text-gray-200',
  analyzing: 'bg-blue-900 text-blue-300',
  analyzed: 'bg-yellow-900 text-yellow-300',
  approved: 'bg-green-900 text-green-300',
  skipped: 'bg-gray-800 text-gray-500',
  briefed: 'bg-purple-900 text-purple-300',
  published: 'bg-indigo-900 text-indigo-300',
}

// Funnel counts — each stage includes everything downstream. So "analyzed"
// counts every reel that ever passed analyze, even if it has since moved on
// to approved/briefed/published. Otherwise the dashboard reads "0 analyzed,
// 0 approved" the moment you generate a brief and feels broken.
const FUNNEL_INCLUDES: Record<string, ReadonlyArray<string>> = {
  new:       ['new'],
  analyzed:  ['analyzed', 'approved', 'briefed', 'published'],
  approved:  ['approved', 'briefed', 'published'],
  briefed:   ['briefed', 'published'],
  published: ['published'],
  skipped:   ['skipped'],
}

async function getStats() {
  const { data } = await supabase
    .from('trend_reels')
    .select('status')

  const raw: Record<string, number> = {}
  for (const row of data ?? []) {
    raw[row.status] = (raw[row.status] ?? 0) + 1
  }

  const counts: Record<string, number> = {}
  for (const [bucket, statuses] of Object.entries(FUNNEL_INCLUDES)) {
    counts[bucket] = statuses.reduce((sum, s) => sum + (raw[s] ?? 0), 0)
  }
  return counts
}

async function getRecentReels() {
  const { data } = await supabase
    .from('trend_reels')
    .select('id, status, views_count, thumbnail_url, discovered_at, trend_accounts(username)')
    .order('discovered_at', { ascending: false })
    .limit(6)
  return data ?? []
}

async function getActiveAccounts() {
  const { count } = await supabase
    .from('trend_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
  return count ?? 0
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

async function getTotalReels() {
  const { count } = await supabase
    .from('trend_reels')
    .select('id', { count: 'exact', head: true })
  return count ?? 0
}

export default async function DashboardPage() {
  const [counts, recent, activeAccounts, total] = await Promise.all([
    getStats(),
    getRecentReels(),
    getActiveAccounts(),
    getTotalReels(),
  ])

  return (
    <Shell>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">
            Monitoring {activeAccounts} active account{activeAccounts !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Status counts */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {STATUS_ORDER.filter(s => s !== 'analyzing').map(s => (
            <Link
              key={s}
              href={`/discover?status=${s}`}
              className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors"
            >
              <div className="text-3xl font-bold text-white">{counts[s] ?? 0}</div>
              <div className={`inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[s]}`}>
                {s}
              </div>
            </Link>
          ))}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-3xl font-bold text-white">{total}</div>
            <div className="text-gray-400 text-xs mt-2">total reels</div>
          </div>
        </div>

        {/* Recent discoveries */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Recent</h2>
            <Link href="/discover" className="text-sm text-gray-400 hover:text-white">View all →</Link>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {recent.map(reel => {
              const acct = reel.trend_accounts
              const account = Array.isArray(acct) ? (acct[0] as { username: string } | undefined)?.username : (acct as { username: string } | null)?.username
              return (
                <Link
                  key={reel.id}
                  href={`/discover/${reel.id}`}
                  className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-600 transition-colors group"
                >
                  <div className="aspect-[9/5] bg-gray-800 relative overflow-hidden">
                    {reel.thumbnail_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/img?url=${encodeURIComponent(reel.thumbnail_url)}`}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    )}
                    <div className="absolute top-2 right-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[reel.status]}`}>
                        {reel.status}
                      </span>
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 text-xs">@{account}</span>
                      <span className="text-white text-sm font-semibold">{fmt(reel.views_count)}</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex gap-3">
          <Link
            href="/sync"
            className="px-4 py-2 bg-wine-700 hover:bg-wine-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Sync now
          </Link>
          <Link
            href="/accounts/discover"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm rounded-lg transition-colors"
          >
            Find accounts
          </Link>
        </div>
      </div>
    </Shell>
  )
}
