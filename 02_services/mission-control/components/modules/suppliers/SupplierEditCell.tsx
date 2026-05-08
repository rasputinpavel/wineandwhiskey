'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupplierType } from '@/lib/supabase'

export function SupplierTermsCell({ supplierId, initial }: {
  supplierId: string
  initial: number
}) {
  const router = useRouter()
  const [value, setValue] = useState<string>(String(initial))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const n = Number(value)
    if (Number.isNaN(n) || n < 0) { setErr('Number ≥ 0'); return }
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/m/suppliers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: supplierId, payment_terms_days: n }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setEditing(false)
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? 'save failed')
    } finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`text-left ${initial === 0 ? 'text-graphite italic hover:text-wine-red' : 'text-deep-black hover:text-wine-red'}`}
        title="Click to edit"
      >
        {initial === 0 ? 'set terms' : `${initial} days`}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number" min={0} autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setEditing(false); setValue(String(initial)) }
        }}
        className="w-16 px-1.5 py-0.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
        disabled={saving}
      />
      <button onClick={save} disabled={saving}
              className="text-[10px] px-1.5 py-0.5 bg-wine-red text-warm-white rounded-sm disabled:opacity-50">
        {saving ? '…' : '✓'}
      </button>
      <button onClick={() => { setEditing(false); setValue(String(initial)); setErr(null) }} disabled={saving}
              className="text-[10px] text-graphite hover:text-wine-red">✕</button>
      {err && <span className="text-[10px] text-wine-red ml-1">{err}</span>}
    </span>
  )
}

const TYPE_LABEL: Record<SupplierType, string> = {
  regular:     'Regular',
  consignment: 'Consignment',
  mix:         'Mix',
}

const TYPE_TITLE: Record<SupplierType, string> = {
  regular:     'All products via tax invoice (instant obligation)',
  consignment: 'All products via delivery note (monthly true-up)',
  mix:         'Part regular, part consignment',
}

const TYPE_CLS: Record<SupplierType, string> = {
  regular:     'bg-cream text-graphite border-pale-stone',
  consignment: 'bg-amber-gold/20 text-deep-black border-amber-gold/60',
  mix:         'bg-wine-red/10 text-wine-red border-wine-red/40',
}

const NEXT: Record<SupplierType, SupplierType> = {
  regular: 'consignment', consignment: 'mix', mix: 'regular',
}

export function SupplierTypeCell({ supplierId, initial }: {
  supplierId: string
  initial: SupplierType
}) {
  const router = useRouter()
  const [type, setType] = useState<SupplierType>(initial)
  const [saving, setSaving] = useState(false)

  async function cycle() {
    const next = NEXT[type]
    setSaving(true)
    try {
      const res = await fetch('/api/m/suppliers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: supplierId, type: next }),
      })
      if (res.ok) {
        setType(next)
        router.refresh()
      }
    } finally { setSaving(false) }
  }

  return (
    <button
      onClick={cycle}
      disabled={saving}
      className={`text-xs px-2 py-0.5 rounded-sm border transition-colors disabled:opacity-50 hover:opacity-80 ${TYPE_CLS[type]}`}
      title={`${TYPE_TITLE[type]}\n\nClick to cycle → ${TYPE_LABEL[NEXT[type]]}`}
    >
      {TYPE_LABEL[type]}
    </button>
  )
}
