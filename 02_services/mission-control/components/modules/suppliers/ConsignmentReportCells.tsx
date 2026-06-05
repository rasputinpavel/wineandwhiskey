'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const API = '/api/m/consignment-report'

// `auto` is the Loyverse-computed value; if `override` is non-null we show
// the override and tag the cell as edited. Click-to-edit. Clearing the
// input reverts to auto.
export function OverrideNumCell({ supplierId, skuId, period, field, auto, override, salesHref }: {
  supplierId: string; skuId: string; period: string
  field: 'b2c_override' | 'b2b_override'
  auto: number; override: number | null
  salesHref: string
}) {
  const router = useRouter()
  const initial = override ?? auto
  const [value, setValue] = useState(String(initial))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save(nextValue: number | null) {
    setSaving(true); setErr(null)
    try {
      const res = await fetch(API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: supplierId, sku_id: skuId, period, field, value: nextValue }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setEditing(false); router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'save failed') }
    finally { setSaving(false) }
  }

  async function submitFromInput() {
    const trimmed = value.trim()
    if (trimmed === '') return save(null)  // clear override → revert to auto
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n < 0) { setErr('≥ 0'); return }
    save(Math.round(n))
  }

  if (!editing) {
    const display = initial
    return (
      <span className="inline-flex items-center gap-1 justify-end w-full">
        <button
          onClick={() => setEditing(true)}
          className={`text-right tabular-nums hover:text-wine-red ${override != null ? 'text-wine-red' : 'text-deep-black'}`}
          title={override != null ? `Manual override (auto = ${auto.toLocaleString('en-US')}). Click to edit.` : 'Click to edit'}
        >
          {display === 0 ? <span className="text-graphite/40">—</span> : display.toLocaleString('en-US')}
        </button>
        {display > 0 && (
          <a
            href={salesHref}
            className="text-[10px] text-graphite/60 hover:text-wine-red"
            title="Show underlying sales"
          >→</a>
        )}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number" min={0} step={1} autoFocus
        value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submitFromInput()
          if (e.key === 'Escape') { setEditing(false); setValue(String(initial)); setErr(null) }
        }}
        placeholder={String(auto)}
        className="w-16 px-1.5 py-0.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
        disabled={saving}
      />
      <button onClick={submitFromInput} disabled={saving} className="text-[10px] px-1.5 py-0.5 bg-wine-red text-warm-white rounded-sm disabled:opacity-50">{saving ? '…' : '✓'}</button>
      {override != null && (
        <button onClick={() => save(null)} disabled={saving} className="text-[10px] text-graphite hover:text-wine-red" title="Revert to auto">↻</button>
      )}
      <button onClick={() => { setEditing(false); setValue(String(initial)); setErr(null) }} disabled={saving} className="text-[10px] text-graphite hover:text-wine-red">✕</button>
      {err && <span className="text-[10px] text-wine-red ml-1">{err}</span>}
    </span>
  )
}

// Closing stock = opening − sold (auto), with optional manual override.
// `auto` is the computed value (may be null if opening is unknown); `override`
// is the stored closing_stock. Click to override, clear the input to revert.
export function ClosingCell({ supplierId, skuId, period, auto, override }: {
  supplierId: string; skuId: string; period: string
  auto: number | null; override: number | null
}) {
  const router = useRouter()
  const initial = override ?? auto
  const [value, setValue] = useState(initial == null ? '' : String(initial))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save(next: number | null) {
    setSaving(true); setErr(null)
    try {
      const res = await fetch(API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: supplierId, sku_id: skuId, period, field: 'closing_stock', value: next }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      setEditing(false); router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'save failed') }
    finally { setSaving(false) }
  }

  function submit() {
    const t = value.trim()
    if (t === '') return save(null)  // clear → revert to auto
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0) { setErr('≥ 0'); return }
    save(Math.round(n))
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`text-right tabular-nums hover:text-wine-red w-full ${override != null ? 'text-wine-red' : 'text-deep-black'}`}
        title={override != null ? `Manual (auto = ${auto ?? '—'}). Click to edit.` : 'Auto = opening − sold. Click to override.'}
      >
        {initial == null ? <span className="text-graphite/40">—</span> : initial.toLocaleString('en-US')}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number" min={0} step={1} autoFocus
        value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') { setEditing(false); setValue(initial == null ? '' : String(initial)); setErr(null) }
        }}
        placeholder={auto == null ? '' : String(auto)}
        className="w-16 px-1.5 py-0.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
        disabled={saving}
      />
      <button onClick={submit} disabled={saving} className="text-[10px] px-1.5 py-0.5 bg-wine-red text-warm-white rounded-sm disabled:opacity-50">{saving ? '…' : '✓'}</button>
      {override != null && (
        <button onClick={() => save(null)} disabled={saving} className="text-[10px] text-graphite hover:text-wine-red" title="Revert to auto">↻</button>
      )}
      <button onClick={() => { setEditing(false); setValue(initial == null ? '' : String(initial)); setErr(null) }} disabled={saving} className="text-[10px] text-graphite hover:text-wine-red">✕</button>
      {err && <span className="text-[10px] text-wine-red ml-1">{err}</span>}
    </span>
  )
}

export function NumCell({ supplierId, skuId, period, field, initial }: {
  supplierId: string; skuId: string; period: string
  field: 'opening_stock' | 'closing_stock' | 'tastings'
  initial: number | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(initial == null ? '' : String(initial))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const trimmed = value.trim()
    const parsed = trimmed === '' ? null : Number(trimmed)
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) { setErr('≥ 0'); return }
    setSaving(true); setErr(null)
    try {
      const res = await fetch(API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: supplierId, sku_id: skuId, period, field, value: parsed }),
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
      <button
        onClick={() => setEditing(true)}
        className="text-right tabular-nums text-deep-black hover:text-wine-red w-full"
        title="Click to edit"
      >
        {initial == null ? <span className="text-graphite/40">—</span> : initial.toLocaleString('en-US')}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number" min={0} step={1} autoFocus
        value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setEditing(false); setValue(initial == null ? '' : String(initial)); setErr(null) }
        }}
        className="w-16 px-1.5 py-0.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
        disabled={saving}
      />
      <button onClick={save} disabled={saving} className="text-[10px] px-1.5 py-0.5 bg-wine-red text-warm-white rounded-sm disabled:opacity-50">{saving ? '…' : '✓'}</button>
      <button onClick={() => { setEditing(false); setValue(initial == null ? '' : String(initial)); setErr(null) }} disabled={saving} className="text-[10px] text-graphite hover:text-wine-red">✕</button>
      {err && <span className="text-[10px] text-wine-red ml-1">{err}</span>}
    </span>
  )
}

// Manage the per-period list of Loyverse receipts excluded from the
// settlement. Add accepts comma/space-separated numbers (e.g. paste
// "5-8639, 5-8643"). Each chip removes on ✕.
const EXCL_API = '/api/m/consignment-report/exclusions'
export function ReceiptExclusions({ supplierId, period, excluded, tableMissing }: {
  supplierId: string; period: string; excluded: string[]; tableMissing?: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    const v = value.trim()
    if (!v) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(EXCL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: supplierId, period, receipt_number: v }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      setValue(''); router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'failed') }
    finally { setBusy(false) }
  }

  async function remove(num: string) {
    setBusy(true); setErr(null)
    try {
      const qs = new URLSearchParams({ supplier_id: supplierId, period, receipt_number: num })
      const res = await fetch(`${EXCL_API}?${qs}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'failed') }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-4 p-3 bg-cream/40 border border-pale-stone rounded-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-graphite">Excluded receipts ({period}):</span>
        {excluded.length === 0 && <span className="text-xs text-graphite/50">none</span>}
        {excluded.map(num => (
          <span key={num} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono bg-warm-white border border-pale-stone rounded-sm">
            {num}
            <button onClick={() => remove(num)} disabled={busy} className="text-graphite hover:text-wine-red disabled:opacity-50" title="Remove">✕</button>
          </span>
        ))}
        <span className="flex items-center gap-1 ml-auto">
          <input
            value={value} onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }}
            placeholder="5-8639, 5-8643…"
            className="w-44 px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red bg-warm-white"
            disabled={busy}
          />
          <button onClick={add} disabled={busy} className="text-xs px-3 py-1 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep disabled:opacity-50">
            {busy ? '…' : 'Exclude'}
          </button>
        </span>
      </div>
      {tableMissing && <p className="mt-2 text-[11px] text-wine-red">Exclusions table missing — apply migration 021_consignment_report_exclusion.sql in Supabase.</p>}
      {err && <p className="mt-2 text-[11px] text-wine-red">{err}</p>}
      <p className="mt-2 text-[11px] text-graphite/70">Units on these receipts are dropped from the per-SKU totals and the settlement below.</p>
    </div>
  )
}

// Close / reopen the period. Closing persists each SKU's effective closing
// stock (→ next month's opening) and marks the report agreed.
export function ClosePeriodButton({ supplierId, period, closings, closedAt }: {
  supplierId: string; period: string
  closings: Array<{ sku_id: string; closing: number }>
  closedAt: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function close() {
    if (!confirm(`Close ${period}? Closing stock is saved and carried to next month as Opening.`)) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/m/consignment-report/close', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: supplierId, period, closings }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'failed') }
    finally { setBusy(false) }
  }

  async function reopen() {
    setBusy(true); setErr(null)
    try {
      const qs = new URLSearchParams({ supplier_id: supplierId, period })
      const res = await fetch(`/api/m/consignment-report/close?${qs}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'failed') }
    finally { setBusy(false) }
  }

  if (closedAt) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs px-2 py-1 rounded-sm bg-amber-gold/20 text-deep-black border border-amber-gold/60">Closed {closedAt.slice(0, 10)}</span>
        <button onClick={reopen} disabled={busy} className="text-xs text-graphite hover:text-wine-red disabled:opacity-50">{busy ? '…' : 'Reopen'}</button>
        {err && <span className="text-[10px] text-wine-red">{err}</span>}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={close} disabled={busy} className="text-xs px-3 py-1 bg-wine-red text-warm-white rounded-sm hover:bg-burgundy-deep disabled:opacity-50">
        {busy ? 'Closing…' : 'Close period'}
      </button>
      {err && <span className="text-[10px] text-wine-red">{err}</span>}
    </span>
  )
}

export function ExportCsvButton({ rows, period, supplierName }: {
  rows: Array<{ sku: string; opening: number | null; delivered: number; b2c: number; b2b: number; total: number; tastings: number; closing: number | null; hc: number | string; amount: number | string }>
  period: string
  supplierName: string
}) {
  function download() {
    const header = ['SKU', `Opening (${period})`, 'Delivered', 'Sold B2C', 'Sold B2B', 'TOTAL', 'Tastings', `Closing (${period})`, 'HC price', 'Amount (HC)']
    const csv = [header.join(',')].concat(
      rows.map(r => [
        JSON.stringify(r.sku),
        r.opening ?? '',
        r.delivered,
        r.b2c,
        r.b2b,
        r.total,
        r.tastings,
        r.closing ?? '',
        r.hc,
        r.amount,
      ].join(','))
    ).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${supplierName.replace(/\s+/g, '_')}_${period}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <button onClick={download} className="text-xs px-3 py-1 border border-pale-stone rounded-sm hover:border-wine-red hover:text-wine-red">
      Export CSV
    </button>
  )
}
