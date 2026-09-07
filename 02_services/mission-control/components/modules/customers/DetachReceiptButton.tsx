'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Undo a manual B2B attribution: the receipt goes back to whatever the
// classifier derives from its payments and customer card.
export function DetachReceiptButton({ receiptNumber }: { receiptNumber: string }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function detach() {
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/m/receipts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt_number: receiptNumber, b2b_customer_id: null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? 'failed')
    } finally { setSaving(false) }
  }

  return (
    <button
      onClick={detach}
      disabled={saving}
      title={err ?? 'Undo the manual B2B attribution — the classifier takes this receipt back'}
      className={`text-[10px] px-1 leading-none disabled:opacity-50 ${err ? 'text-wine-red' : 'text-graphite hover:text-wine-red'}`}
    >
      ✕
    </button>
  )
}
