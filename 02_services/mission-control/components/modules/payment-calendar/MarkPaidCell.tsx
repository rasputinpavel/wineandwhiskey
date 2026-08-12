'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// A single "mark paid / un-mark" control for OUT rows that live outside purchase_orders
// (mandatory obligations, big one-offs). Parameterised by endpoint + payloads so the two
// kinds share one component. On success calls onSaved('paid'|null) so the Timeline runs
// its existing flash-and-exit (Open) or refresh (month) behaviour.
export function MarkPaidCell({ paid, endpoint, method, payloadPaid, payloadUnpaid, onSaved }: {
  paid: boolean
  endpoint: string
  method: 'PUT' | 'PATCH'
  payloadPaid: Record<string, unknown>
  payloadUnpaid: Record<string, unknown>
  onSaved?: (value: string | null) => void
}) {
  const router = useRouter()
  const [isPaid, setPaid] = useState(paid)
  const [saving, setSaving] = useState(false)

  async function toggle(next: boolean) {
    setSaving(true)
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next ? payloadPaid : payloadUnpaid),
      })
      if (res.ok) {
        setPaid(next)
        if (onSaved) onSaved(next ? 'paid' : null)
        else router.refresh()
      }
    } finally { setSaving(false) }
  }

  if (isPaid) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block px-2 py-0.5 text-[11px] rounded-sm border bg-emerald-600/10 text-emerald-700 border-emerald-600/40">оплачено</span>
        <button onClick={() => toggle(false)} disabled={saving}
                className="text-[11px] text-graphite hover:text-wine-red disabled:opacity-50" title="снять отметку">✕</button>
      </span>
    )
  }
  return (
    <button onClick={() => toggle(true)} disabled={saving}
            className="text-[11px] px-2 py-0.5 border border-pale-stone rounded-sm text-graphite hover:border-wine-red hover:text-wine-red disabled:opacity-50">
      {saving ? '…' : 'оплачено?'}
    </button>
  )
}
