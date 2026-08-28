'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SkuPickerInline } from '@/components/modules/customers/SkuPickerInline'

const API = '/api/m/consignment-deliveries'

type Line = { key: number; sku_id: string | null; sku_name: string | null; qty: string }

const newLine = (key: number): Line => ({ key, sku_id: null, sku_name: null, qty: '' })

// "New delivery" form: one header (date + supplier's TDN number) and as many
// SKU lines as the delivery note has. Save posts them all in one call, so a
// delivery is entered as a document rather than row by row. There is no header
// table in the DB — the rows are tied together by (delivered_at, note), which
// is also how the list below groups them.
export function NewDeliveryForm({ supplierId }: { supplierId: string }) {
  const router = useRouter()
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine(1)])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Default the date to today on mount (avoids SSR/client hydration mismatch).
  useEffect(() => { if (!date) setDate(new Date().toISOString().slice(0, 10)) }, [date])

  function addLine() { setLines(ls => [...ls, newLine((ls[ls.length - 1]?.key ?? 0) + 1)]) }
  function removeLine(key: number) { setLines(ls => ls.length === 1 ? [newLine(1)] : ls.filter(l => l.key !== key)) }
  function update(key: number, patch: Partial<Line>) {
    setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l))
  }

  const filled = lines.filter(l => l.sku_id && Number.isInteger(Number(l.qty)) && Number(l.qty) !== 0)
  const totalUnits = filled.reduce((s, l) => s + Number(l.qty), 0)

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setErr('pick a date'); return }
    if (filled.length === 0) { setErr('add at least one line with a SKU and qty ≠ 0'); return }
    setSaving(true); setErr(null)
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: supplierId,
          delivered_at: date,
          note: note.trim() || null,
          lines: filled.map(l => ({ sku_id: l.sku_id, qty: Number(l.qty) })),
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      setNote(''); setLines([newLine(1)])   // keep the date for the next delivery
      router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'save failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="mt-4 p-4 bg-cream/40 border border-pale-stone rounded-sm">
      <h3 className="font-heading text-base text-deep-black mb-3">New delivery</h3>

      <div className="flex items-center gap-3 flex-wrap mb-3">
        <label className="text-[11px] text-graphite">
          Date{' '}
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="ml-1 px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
            disabled={saving}
          />
        </label>
        <label className="text-[11px] text-graphite flex-1 min-w-[14rem]">
          Delivery note no. / comment{' '}
          <input
            type="text" placeholder="TDN-20260600009" value={note} onChange={e => setNote(e.target.value)}
            className="ml-1 w-full max-w-[22rem] px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
            disabled={saving}
          />
        </label>
      </div>

      <div className="space-y-2">
        {lines.map(l => (
          <div key={l.key} className="flex items-start gap-2">
            <div className="flex-1 min-w-[16rem]">
              {/* The picker's own input keeps showing the picked name, so no
                  separate "selected" line is needed here. */}
              <SkuPickerInline
                onPick={sku => { update(l.key, { sku_id: sku.id, sku_name: sku.name }); setErr(null) }}
              />
            </div>
            <input
              type="number" step={1} placeholder="Qty"
              value={l.qty} onChange={e => update(l.key, { qty: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') addLine() }}
              className="w-20 px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
              disabled={saving}
            />
            <button
              onClick={() => removeLine(l.key)} disabled={saving}
              className="px-1 py-1 text-[11px] text-graphite hover:text-wine-red disabled:opacity-50"
              title="Remove line"
            >✕</button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <button
          onClick={addLine} disabled={saving}
          className="text-xs px-3 py-1 border border-pale-stone rounded-sm text-graphite hover:text-wine-red hover:border-wine-red disabled:opacity-50"
        >+ Line</button>
        <span className="text-[11px] text-graphite tabular-nums">
          {filled.length} line{filled.length === 1 ? '' : 's'} · {totalUnits.toLocaleString('en-US')} units
        </span>
        <button
          onClick={save} disabled={saving}
          className="text-xs px-3 py-1 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep disabled:opacity-50 ml-auto"
        >{saving ? 'Saving…' : 'Save delivery'}</button>
        {err && <span className="text-[10px] text-wine-red w-full">{err}</span>}
      </div>
    </div>
  )
}

export function DeleteDeliveryCell({ id, label }: { id: string; label: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function del() {
    if (!confirm(`Delete delivery line "${label}"?`)) return
    setBusy(true)
    try {
      const res = await fetch(`${API}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (res.ok) router.refresh()
    } finally { setBusy(false) }
  }
  return (
    <button onClick={del} disabled={busy} className="text-[11px] text-graphite hover:text-wine-red disabled:opacity-50" title="Delete line">
      {busy ? '…' : '✕'}
    </button>
  )
}

// Deletes every line of one delivery — same (supplier, date, note) key the
// page groups by.
export function DeleteDeliveryGroupCell({ supplierId, deliveredAt, note, lineCount }: {
  supplierId: string; deliveredAt: string; note: string | null; lineCount: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function del() {
    if (!confirm(`Delete the whole delivery of ${deliveredAt}${note ? ` (${note})` : ''} — ${lineCount} line${lineCount === 1 ? '' : 's'}?`)) return
    setBusy(true)
    try {
      const qs = new URLSearchParams({ group: '1', supplier_id: supplierId, delivered_at: deliveredAt })
      if (note) qs.set('note', note)
      const res = await fetch(`${API}?${qs}`, { method: 'DELETE' })
      if (res.ok) router.refresh()
    } finally { setBusy(false) }
  }
  return (
    <button onClick={del} disabled={busy} className="text-[11px] text-graphite hover:text-wine-red disabled:opacity-50" title="Delete whole delivery">
      {busy ? '…' : '✕ delivery'}
    </button>
  )
}
