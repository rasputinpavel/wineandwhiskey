'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function POExcludeCell({ poId, initial }: {
  poId: number
  initial: boolean
}) {
  const router = useRouter()
  const [excluded, setExcluded] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    const next = !excluded
    setSaving(true)
    try {
      const res = await fetch('/api/m/purchases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: poId, exclude_from_cashflow: next }),
      })
      if (res.ok) {
        setExcluded(next)
        router.refresh()
      }
    } finally { setSaving(false) }
  }

  return (
    <button
      onClick={toggle}
      disabled={saving}
      className={`text-xs px-2 py-0.5 rounded-sm border transition-colors disabled:opacity-50 hover:opacity-80 ${
        excluded
          ? 'bg-wine-red/10 text-wine-red border-wine-red/40'
          : 'bg-cream text-graphite border-pale-stone'
      }`}
      title={excluded
        ? 'Этот PO исключён из cashflow / P&L. Click чтобы включить обратно.'
        : 'PO учитывается в cashflow / P&L. Click чтобы исключить (для криво заведённых).'}
    >
      {excluded ? 'excluded' : 'in cashflow'}
    </button>
  )
}
