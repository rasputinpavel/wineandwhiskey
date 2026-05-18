'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PROMO_STATUSES, PROMO_STATUS_LABEL, type PromoStatus } from '@/lib/promo/types'

// Phase 1 actions: flip status (draft ↔ ready) and delete. Phase 2 and 3 will
// add "Generate copy" and "Generate visuals" buttons here.

export function PromoActionsClient({ id, status: initialStatus }: { id: string; status: PromoStatus }) {
  const router = useRouter()
  const [status, setStatus] = useState<PromoStatus>(initialStatus)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setStatusTo(next: PromoStatus) {
    if (next === status) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/m/promo/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to update')
      setStatus(next)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Delete this promo? This cannot be undone.')) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/m/promo/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to delete')
      router.push('/m/promo')
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={status}
        onChange={e => setStatusTo(e.target.value as PromoStatus)}
        disabled={busy}
        className="text-xs border border-pale-stone bg-warm-white rounded-sm px-2 py-1.5"
      >
        {PROMO_STATUSES.map(s => (
          <option key={s} value={s}>{PROMO_STATUS_LABEL[s]}</option>
        ))}
      </select>
      <button onClick={remove} disabled={busy}
        className="text-xs px-2 py-1.5 border border-pale-stone text-graphite rounded-sm hover:border-wine-red hover:text-wine-red disabled:opacity-50">
        Delete
      </button>
      {error && <span className="text-[11px] text-wine-red">{error}</span>}
    </div>
  )
}
