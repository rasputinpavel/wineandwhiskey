'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const API = '/api/m/consignment-report'

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

export function ExportCsvButton({ rows, period, supplierName }: {
  rows: Array<{ sku: string; opening: number | null; b2c: number; b2b: number; tastings: number; total: number; closing: number | null }>
  period: string
  supplierName: string
}) {
  function download() {
    const header = ['SKU', `Opening (${period})`, 'Sold B2C', 'Sold B2B', 'Tastings', 'TOTAL', `Closing (${period})`]
    const csv = [header.join(',')].concat(
      rows.map(r => [
        JSON.stringify(r.sku),
        r.opening ?? '',
        r.b2c,
        r.b2b,
        r.tastings,
        r.total,
        r.closing ?? '',
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
