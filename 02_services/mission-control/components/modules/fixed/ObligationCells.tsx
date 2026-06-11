'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReconcileStatus } from '@/lib/mandatory'

const API = '/api/m/mandatory-actual'

// Inline controls for one obligation on the Fixed Costs → Month view. Each
// obligation reconciles to FACT live from the Expenses sheet; these write a
// manual override (inventory.mandatory_actual) when the owner corrects it.

async function putOverride(body: Record<string, unknown>) {
  const res = await fetch(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`) }
}

// Editable actual amount. Saving marks the obligation paid with that amount.
export function ActualCell({ fixedCostId, period, actual, source }: {
  fixedCostId: string; period: string; actual: number | null; source: 'override' | 'sheet' | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(actual == null ? '' : String(Math.round(actual)))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const trimmed = value.trim()
    const n = trimmed === '' ? null : Number(trimmed)
    if (n != null && (!Number.isFinite(n) || n < 0)) { setErr('≥ 0'); return }
    setSaving(true); setErr(null)
    try {
      await putOverride({ fixed_cost_id: fixedCostId, period, paid: n != null, amount_thb: n })
      setEditing(false); router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'save failed') }
    finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-right tabular-nums text-deep-black hover:text-wine-red" title="Click to set actual paid">
        {actual == null
          ? <span className="text-graphite">—</span>
          : <>฿{Math.round(actual).toLocaleString('en-US')}{source === 'override' && <span className="text-amber-gold ml-0.5" title="manual override">*</span>}</>}
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 justify-end">
      <input
        type="number" min={0} step={100} autoFocus placeholder="—"
        value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setValue(actual == null ? '' : String(Math.round(actual))) } }}
        className="w-24 px-1.5 py-0.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
        disabled={saving}
      />
      <button onClick={save} disabled={saving} className="text-[10px] px-1.5 py-0.5 bg-wine-red text-warm-white rounded-sm disabled:opacity-50">{saving ? '…' : '✓'}</button>
      <button onClick={() => { setEditing(false); setValue(actual == null ? '' : String(Math.round(actual))); setErr(null) }} disabled={saving} className="text-[10px] text-graphite hover:text-wine-red">✕</button>
      {err && <span className="text-[10px] text-wine-red ml-1">{err}</span>}
    </span>
  )
}

const STATUS_STYLE: Record<ReconcileStatus, string> = {
  paid:    'bg-emerald-600/10 text-emerald-700 border-emerald-600/30',
  overdue: 'bg-wine-red/10 text-wine-red border-wine-red/30',
  pending: 'bg-cream text-graphite border-pale-stone',
}
const STATUS_LABEL: Record<ReconcileStatus, string> = { paid: 'Paid', overdue: 'Overdue', pending: 'Pending' }

// Status badge that toggles paid/unpaid, plus a reset-to-sheet link for overrides.
export function StatusCell({ fixedCostId, period, status, planned, source }: {
  fixedCostId: string; period: string; status: ReconcileStatus; planned: number; source: 'override' | 'sheet' | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function togglePaid() {
    setBusy(true)
    try {
      // Marking paid with no actual yet → seed the planned amount.
      await putOverride({ fixed_cost_id: fixedCostId, period, paid: status !== 'paid', ...(status !== 'paid' ? { amount_thb: Math.round(planned) } : {}) })
      router.refresh()
    } finally { setBusy(false) }
  }

  async function reset() {
    setBusy(true)
    try {
      await fetch(`${API}?fixed_cost_id=${encodeURIComponent(fixedCostId)}&period=${encodeURIComponent(period)}`, { method: 'DELETE' })
      router.refresh()
    } finally { setBusy(false) }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={togglePaid} disabled={busy}
        className={`text-[11px] px-2 py-0.5 rounded-sm border transition-colors disabled:opacity-50 ${STATUS_STYLE[status]}`}
        title={status === 'paid' ? 'Click to mark unpaid' : 'Click to mark paid'}
      >
        {busy ? '…' : STATUS_LABEL[status]}
      </button>
      {source === 'override' && (
        <button onClick={reset} disabled={busy} className="text-[10px] text-graphite hover:text-wine-red" title="Reset to the Expenses-sheet match">
          reset
        </button>
      )}
    </span>
  )
}
