'use client'

import { useState, useEffect } from 'react'
import Shell from '@/components/Shell'
import Link from 'next/link'

type Account = {
  id: string
  username: string
  display_name: string | null
  followers_count: number | null
  avg_reel_views: number | null
  relevance_score: number | null
  category: string | null
  is_active: boolean
  last_reel_at: string | null
}

function fmt(n: number | null) {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addUsername, setAddUsername] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setError(null)
    const res = await fetch('/api/accounts')
    if (res.ok) {
      setAccounts(await res.json())
    } else {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `HTTP ${res.status}`)
    }
    setLoading(false)
  }

  async function toggleActive(account: Account) {
    await fetch('/api/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: account.id, is_active: !account.is_active }),
    })
    load()
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addUsername.trim()) return
    setAdding(true)
    await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: addUsername.trim().replace('@', '') }),
    })
    setAddUsername('')
    await load()
    setAdding(false)
  }

  const active = accounts.filter(a => a.is_active)
  const inactive = accounts.filter(a => !a.is_active)

  return (
    <Shell>
      <div className="p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Accounts</h1>
            <p className="text-gray-400 text-sm mt-1">{active.length} active · {accounts.length} total</p>
          </div>
          <Link
            href="/accounts/discover"
            className="px-4 py-2 bg-wine-700 hover:bg-wine-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Find accounts
          </Link>
        </div>

        {/* Add manually */}
        <form onSubmit={handleAdd} className="flex gap-3 mb-8">
          <input
            value={addUsername}
            onChange={e => setAddUsername(e.target.value)}
            placeholder="@username or username"
            className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 text-sm"
          />
          <button
            type="submit"
            disabled={adding || !addUsername.trim()}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            Add
          </button>
        </form>

        {loading ? (
          <div className="text-gray-500">Loading…</div>
        ) : error ? (
          <div className="text-red-400 bg-red-950 border border-red-800 rounded-xl p-4 text-sm font-mono">{error}</div>
        ) : (
          <div className="space-y-6">
            {/* Active */}
            {active.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Active ({active.length})</h2>
                <div className="space-y-2">
                  {active.map(a => (
                    <AccountRow key={a.id} account={a} onToggle={() => toggleActive(a)} />
                  ))}
                </div>
              </div>
            )}

            {/* Inactive */}
            {inactive.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Inactive ({inactive.length})</h2>
                <div className="space-y-2">
                  {inactive.map(a => (
                    <AccountRow key={a.id} account={a} onToggle={() => toggleActive(a)} />
                  ))}
                </div>
              </div>
            )}

            {!accounts.length && (
              <p className="text-gray-500 text-center py-10">No accounts yet. Add manually or use Find accounts.</p>
            )}
          </div>
        )}
      </div>
    </Shell>
  )
}

function AccountRow({ account, onToggle }: { account: Account; onToggle: () => void }) {
  function fmt(n: number | null) {
    if (n === null) return '—'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
    return String(n)
  }

  return (
    <div className={`flex items-center gap-4 px-4 py-3 rounded-xl border ${
      account.is_active ? 'bg-gray-900 border-gray-800' : 'bg-gray-950 border-gray-900'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-medium">@{account.username}</span>
          {account.display_name && (
            <span className="text-gray-500 text-sm">{account.display_name}</span>
          )}
          {account.category && (
            <span className="text-xs px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">{account.category}</span>
          )}
        </div>
      </div>

      <div className="flex gap-6 text-sm text-gray-400">
        <span title="Followers">{fmt(account.followers_count)} followers</span>
        <span title="Avg reel views">{fmt(account.avg_reel_views)} avg views</span>
        {account.relevance_score && (
          <span title="Relevance score" className={
            account.relevance_score >= 8 ? 'text-green-400'
            : account.relevance_score >= 5 ? 'text-yellow-400'
            : 'text-gray-500'
          }>
            {account.relevance_score}/10
          </span>
        )}
      </div>

      <button
        onClick={onToggle}
        className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
          account.is_active
            ? 'bg-green-900 text-green-300 hover:bg-red-900 hover:text-red-300'
            : 'bg-gray-800 text-gray-400 hover:bg-green-900 hover:text-green-300'
        }`}
      >
        {account.is_active ? 'Active' : 'Inactive'}
      </button>
    </div>
  )
}
