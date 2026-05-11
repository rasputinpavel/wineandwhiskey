'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function InvoiceExcludeCell({ invoiceId, initial }: {
  invoiceId: string
  initial: boolean
}) {
  const router = useRouter()
  const [excluded, setExcluded] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    const next = !excluded
    setSaving(true)
    try {
      const res = await fetch('/api/m/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: invoiceId, excluded: next }),
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
      className={`text-[10px] px-1.5 py-0.5 rounded-sm border transition-colors disabled:opacity-50 hover:opacity-80 ${
        excluded
          ? 'bg-wine-red/10 text-wine-red border-wine-red/40'
          : 'bg-cream text-graphite border-pale-stone'
      }`}
      title={excluded
        ? 'Этот инвойс исключён из таблицы. Click чтобы вернуть.'
        : 'Скрыть кривой инвойс из таблицы (sync FlowAccount его не вернёт назад).'}
    >
      {excluded ? 'excluded' : 'in list'}
    </button>
  )
}
