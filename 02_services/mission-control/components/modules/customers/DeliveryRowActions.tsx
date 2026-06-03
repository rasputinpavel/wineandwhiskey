'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Edit / Print / Delete actions for a single delivery-note row.
export function DeliveryRowActions({ customerId, noteId, number }: {
  customerId: string
  noteId: string
  number: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (!confirm(`Delete delivery note ${number}? This cannot be undone.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/m/customers/${customerId}/delivery-notes/${noteId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        alert(`Delete failed: ${j?.error ?? `HTTP ${res.status}`}`)
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-3">
      <Link href={`/m/customers/${customerId}/dn/${noteId}/edit`}
            className="text-xs text-graphite hover:text-wine-red">
        Edit
      </Link>
      <Link href={`/print/dn/${noteId}`} target="_blank"
            className="text-xs text-graphite hover:text-wine-red">
        Print ↗
      </Link>
      <button type="button" onClick={remove} disabled={busy}
              className="text-xs text-graphite hover:text-wine-red disabled:opacity-40">
        {busy ? '…' : 'Delete'}
      </button>
    </div>
  )
}
