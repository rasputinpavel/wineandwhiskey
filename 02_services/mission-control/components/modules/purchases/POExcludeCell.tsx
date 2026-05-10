'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CashflowOverride } from '@/lib/supabase'

const NEXT: Record<CashflowOverride, CashflowOverride> = {
  auto:    'include',
  include: 'exclude',
  exclude: 'auto',
}

const LABEL: Record<CashflowOverride, string> = {
  auto:    'auto',
  include: 'force include',
  exclude: 'force exclude',
}

const TITLE: Record<CashflowOverride, string> = {
  auto:    'Следует типу поставщика. Click → force include',
  include: 'Силой включён в cashflow (override consignment-default). Click → force exclude',
  exclude: 'Силой исключён из cashflow. Click → auto',
}

const CLS: Record<CashflowOverride, string> = {
  auto:    'bg-cream text-graphite border-pale-stone',
  include: 'bg-amber-gold/20 text-deep-black border-amber-gold/60',
  exclude: 'bg-wine-red/10 text-wine-red border-wine-red/40',
}

export function CashflowOverrideCell({ poId, initial }: {
  poId: number
  initial: CashflowOverride
}) {
  const router = useRouter()
  const [val, setVal] = useState<CashflowOverride>(initial)
  const [saving, setSaving] = useState(false)

  async function cycle() {
    const next = NEXT[val]
    setSaving(true)
    try {
      const res = await fetch('/api/m/purchases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: poId, cashflow_override: next }),
      })
      if (res.ok) {
        setVal(next)
        router.refresh()
      }
    } finally { setSaving(false) }
  }

  return (
    <button
      onClick={cycle}
      disabled={saving}
      className={`text-xs px-2 py-0.5 rounded-sm border transition-colors disabled:opacity-50 hover:opacity-80 ${CLS[val]}`}
      title={TITLE[val]}
    >
      {LABEL[val]}
    </button>
  )
}
