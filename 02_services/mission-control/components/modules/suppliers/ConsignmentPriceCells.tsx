'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const API = '/api/m/consignment-prices'

// Inline editors and the "add row" form for a supplier's consignment price
// table. Same shape as customers/suppliers / fixed-cost cells: parent page
// is a server component, each cell PATCHes and asks Next to refresh.

export function PriceCell({ id, initial, field }: {
  id: string; initial: number; field: 'price_hc' | 'price_retail'
}) {
  const router = useRouter()
  const [value, setValue] = useState(String(initial))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) { setErr('≥ 0'); return }
    setSaving(true); setErr(null)
    try {
      const res = await fetch(API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: n }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setEditing(false); router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'save failed') }
    finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-right tabular-nums text-deep-black hover:text-wine-red w-full" title="Click to edit">
        ฿{Math.round(initial).toLocaleString('en-US')}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number" min={0} step={1} autoFocus
        value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setValue(String(initial)) } }}
        className="w-20 px-1.5 py-0.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
        disabled={saving}
      />
      <button onClick={save} disabled={saving} className="text-[10px] px-1.5 py-0.5 bg-wine-red text-warm-white rounded-sm disabled:opacity-50">{saving ? '…' : '✓'}</button>
      <button onClick={() => { setEditing(false); setValue(String(initial)); setErr(null) }} disabled={saving} className="text-[10px] text-graphite hover:text-wine-red">✕</button>
      {err && <span className="text-[10px] text-wine-red ml-1">{err}</span>}
    </span>
  )
}

export function DeletePriceCell({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function del() {
    if (!confirm(`Delete price for "${name}"?`)) return
    setBusy(true)
    try {
      const res = await fetch(`${API}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (res.ok) router.refresh()
    } finally { setBusy(false) }
  }
  return (
    <button onClick={del} disabled={busy} className="text-[11px] text-graphite hover:text-wine-red disabled:opacity-50" title="Delete row">
      {busy ? '…' : '✕'}
    </button>
  )
}

export function NewPriceRow({ supplierId, skus }: {
  supplierId: string
  skus: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [skuId, setSkuId] = useState('')
  const [priceHc, setPriceHc] = useState('')
  const [priceRetail, setPriceRetail] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    const hc = Number(priceHc)
    if (!skuId) { setErr('pick SKU'); return }
    if (!Number.isFinite(hc) || hc < 0) { setErr('HC price ≥ 0'); return }
    setSaving(true); setErr(null)
    try {
      const payload: Record<string, unknown> = { supplier_id: supplierId, sku_id: skuId, price_hc: hc }
      const r = Number(priceRetail)
      if (priceRetail !== '' && Number.isFinite(r) && r >= 0) payload.price_retail = r
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setSkuId(''); setPriceHc(''); setPriceRetail(''); router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'add failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="flex items-center gap-2 mt-4 p-3 bg-cream/40 border border-pale-stone rounded-sm flex-wrap">
      <select
        value={skuId} onChange={e => setSkuId(e.target.value)}
        className="flex-1 min-w-[16rem] px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red bg-warm-white"
        disabled={saving}
      >
        <option value="">— pick SKU —</option>
        {skus.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <input
        type="number" min={0} step={1} placeholder="HC price"
        value={priceHc} onChange={e => setPriceHc(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        className="w-24 px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
        disabled={saving}
      />
      <input
        type="number" min={0} step={1} placeholder="Retail (opt)"
        value={priceRetail} onChange={e => setPriceRetail(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        className="w-24 px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
        disabled={saving}
      />
      <button
        onClick={add} disabled={saving}
        className="text-xs px-3 py-1 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep disabled:opacity-50"
      >
        {saving ? 'Adding…' : '+ Add'}
      </button>
      {err && <span className="text-[10px] text-wine-red">{err}</span>}
    </div>
  )
}
