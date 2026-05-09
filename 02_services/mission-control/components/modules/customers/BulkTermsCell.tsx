'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Bulk-set payment_terms_days. Two-mode UX:
//   - "Set 30 for all without terms" — fast 1-click default
//   - Custom number + scope (all visible | only unset)
//
// Lives on /m/customers and /m/suppliers — endpoint switches via prop.

export function BulkTermsCell({ endpoint, defaultDays = 30 }: {
  endpoint: '/api/m/customers/bulk-terms' | '/api/m/suppliers/bulk-terms'
  defaultDays?: number
}) {
  const router = useRouter()
  const [open, setOpen]     = useState(false)
  const [days, setDays]     = useState(String(defaultDays))
  const [scope, setScope]   = useState<'unset' | 'all'>('unset')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]       = useState<string | null>(null)

  async function apply() {
    const n = Number(days)
    if (!Number.isFinite(n) || n < 0) { setMsg('Enter a non-negative number'); return }
    setSaving(true); setMsg(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: n, scope }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`)
      setMsg(`✓ Updated ${j.updated} row(s)`)
      router.refresh()
    } catch (e: any) {
      setMsg(`✗ ${e?.message ?? 'failed'}`)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite rounded-sm transition-colors"
      >
        Bulk-set terms…
      </button>
    )
  }

  return (
    <div className="bg-warm-white border border-pale-stone rounded-md p-3 inline-flex items-center gap-3 text-xs">
      <span className="text-graphite">Set</span>
      <input
        type="number" min={0} step={1}
        value={days}
        onChange={e => setDays(e.target.value)}
        className="w-16 px-2 py-1 border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red tabular-nums"
        disabled={saving}
      />
      <span className="text-graphite">days for</span>
      <select
        value={scope}
        onChange={e => setScope(e.target.value as 'unset' | 'all')}
        className="px-2 py-1 border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
        disabled={saving}
      >
        <option value="unset">all without terms</option>
        <option value="all">all rows</option>
      </select>
      <button
        onClick={apply}
        disabled={saving}
        className="px-3 py-1 bg-wine-red hover:bg-burgundy-deep text-warm-white rounded-sm disabled:opacity-50"
      >
        {saving ? 'Applying…' : 'Apply'}
      </button>
      <button
        onClick={() => { setOpen(false); setMsg(null) }}
        disabled={saving}
        className="text-graphite hover:text-wine-red"
      >
        ✕
      </button>
      {msg && <span className={msg.startsWith('✓') ? 'text-deep-black' : 'text-wine-red'}>{msg}</span>}
    </div>
  )
}
