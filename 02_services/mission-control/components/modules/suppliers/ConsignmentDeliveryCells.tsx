'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SkuPickerInline } from '@/components/modules/customers/SkuPickerInline'

const API = '/api/m/consignment-deliveries'

// Add-row form: SKU autocomplete + qty + date. The date sticks after each add
// so entering a multi-item delivery is quick.
export function NewDeliveryRow({ supplierId }: { supplierId: string }) {
  const router = useRouter()
  const [skuId, setSkuId] = useState('')
  const [skuName, setSkuName] = useState('')
  const [pickerKey, setPickerKey] = useState(0)
  const [qty, setQty] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Default the date to today on mount (avoids SSR/client hydration mismatch).
  useEffect(() => { if (!date) setDate(new Date().toISOString().slice(0, 10)) }, [date])

  async function add() {
    const n = Number(qty)
    if (!skuId) { setErr('pick SKU'); return }
    if (!Number.isFinite(n) || !Number.isInteger(n) || n === 0) { setErr('qty ≠ 0'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setErr('pick date'); return }
    setSaving(true); setErr(null)
    try {
      const payload: Record<string, unknown> = { supplier_id: supplierId, sku_id: skuId, delivered_at: date, qty: n }
      if (note.trim()) payload.note = note.trim()
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      setSkuId(''); setSkuName(''); setQty(''); setNote('')   // keep date for the next line
      setPickerKey(k => k + 1)
      router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'add failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="flex items-center gap-2 mt-4 p-3 bg-cream/40 border border-pale-stone rounded-sm flex-wrap">
      <div className="flex-1 min-w-[16rem]">
        <SkuPickerInline key={pickerKey} onPick={sku => { setSkuId(sku.id); setSkuName(sku.name); setErr(null) }} />
        {skuName && <p className="mt-1 text-[11px] text-graphite">Selected: <span className="text-deep-black">{skuName}</span></p>}
      </div>
      <input
        type="number" step={1} placeholder="Qty"
        value={qty} onChange={e => setQty(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        className="w-20 px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
        disabled={saving}
      />
      <input
        type="date" value={date} onChange={e => setDate(e.target.value)}
        className="px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
        disabled={saving}
      />
      <input
        type="text" placeholder="Note (opt)"
        value={note} onChange={e => setNote(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        className="w-32 px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
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

export function DeleteDeliveryCell({ id, label }: { id: string; label: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function del() {
    if (!confirm(`Delete delivery "${label}"?`)) return
    setBusy(true)
    try {
      const res = await fetch(`${API}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (res.ok) router.refresh()
    } finally { setBusy(false) }
  }
  return (
    <button onClick={del} disabled={busy} className="text-[11px] text-graphite hover:text-wine-red disabled:opacity-50" title="Delete delivery">
      {busy ? '…' : '✕'}
    </button>
  )
}
