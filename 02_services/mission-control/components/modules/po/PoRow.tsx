'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PoScan } from '@/lib/supabase'
import { NoteCell } from './NoteCell'

// Render a 'YYYY-MM-DD' date as DD.MM.YYYY; pass through anything else.
function fmtD(d: string | null): string {
  if (!d) return '—'
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d
}

function fmtAmount(n: number | null): string {
  return n == null ? '—' : `฿${Math.round(n).toLocaleString('en-US')}`
}

// One Purchase Order row. Read-only until the ✎ pencil is clicked; then supplier,
// №, both dates and the total become inputs, saved together via PATCH
// /api/m/purchase-orders. The Note keeps its own inline editor (NoteCell), so a
// row edit never clobbers a note being written.
export function PoRow({ row, scanUrl }: { row: PoScan; scanUrl?: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [supplier, setSupplier] = useState(row.supplier ?? '')
  const [docNumber, setDocNumber] = useState(row.doc_number ?? '')
  const [orderDate, setOrderDate] = useState((row.order_date ?? '').slice(0, 10))
  const [receivedDate, setReceivedDate] = useState((row.received_date ?? '').slice(0, 10))
  const [amount, setAmount] = useState(row.amount_total == null ? '' : String(row.amount_total))

  function reset() {
    setSupplier(row.supplier ?? '')
    setDocNumber(row.doc_number ?? '')
    setOrderDate((row.order_date ?? '').slice(0, 10))
    setReceivedDate((row.received_date ?? '').slice(0, 10))
    setAmount(row.amount_total == null ? '' : String(row.amount_total))
    setErr(null)
  }

  async function save() {
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/m/purchase-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          supplier,
          doc_number: docNumber,
          order_date: orderDate || null,
          received_date: receivedDate || null,
          amount_total: amount.trim() === '' ? null : amount.trim(),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setEditing(false)
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? 'save failed')
    } finally {
      setSaving(false)
    }
  }

  const input = 'rounded border border-neutral-300 px-1.5 py-0.5 text-sm focus:border-blue-500 focus:outline-none'

  const scanCell = scanUrl ? (
    <a href={scanUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">open ↗</a>
  ) : (
    <span className="text-neutral-400">—</span>
  )

  if (!editing) {
    return (
      <tr className="border-b border-neutral-100">
        <td className="py-2 pr-4 font-medium">{row.supplier ?? '—'}</td>
        <td className="py-2 pr-4">{row.doc_number ?? '—'}</td>
        <td className="py-2 pr-4">{fmtD(row.order_date)}</td>
        <td className="py-2 pr-4 text-right">{fmtAmount(row.amount_total)}</td>
        <td className="py-2 pr-4">{scanCell}</td>
        <td className="py-2 pr-4"><NoteCell scanId={row.id} initial={row.note} /></td>
        <td className="py-2 pr-4">
          <button
            onClick={() => setEditing(true)}
            title="Edit row"
            className="text-neutral-400 hover:text-blue-600"
          >
            ✎
          </button>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-neutral-100 bg-amber-50/40">
      <td className="py-2 pr-4">
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)} disabled={saving} className={`w-40 ${input}`} />
      </td>
      <td className="py-2 pr-4">
        <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} disabled={saving} className={`w-32 ${input}`} />
      </td>
      <td className="py-2 pr-4">
        <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} disabled={saving} className={input} />
      </td>
      <td className="py-2 pr-4 text-right">
        <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={saving} className={`w-24 text-right ${input}`} />
      </td>
      <td className="py-2 pr-4">{scanCell}</td>
      <td className="py-2 pr-4"><NoteCell scanId={row.id} initial={row.note} /></td>
      <td className="py-2 pr-4">
        <span className="inline-flex items-center gap-1">
          <button onClick={save} disabled={saving} className="rounded bg-neutral-900 px-1.5 py-0.5 text-xs text-white disabled:opacity-50">
            {saving ? '…' : '✓'}
          </button>
          <button onClick={() => { setEditing(false); reset() }} disabled={saving} className="text-xs text-neutral-500 hover:text-blue-600">
            ✕
          </button>
          {err && <span className="ml-1 text-xs text-red-600">{err}</span>}
        </span>
      </td>
    </tr>
  )
}
