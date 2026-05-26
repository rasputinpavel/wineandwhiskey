'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const API = '/api/m/fixed-costs'

// Inline-edit cells for inventory.fixed_cost rows on /m/pulse/settings.
// Same shape as customers/suppliers edit cells — server component owns the
// table, each cell is a small client component that PATCHes and refreshes.

export function CategoryCell({ id, initial }: { id: string; initial: string }) {
  const router = useRouter()
  const [value, setValue] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!value.trim()) { setErr('required'); return }
    setSaving(true); setErr(null)
    try {
      const res = await fetch(API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, category: value.trim() }),
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
      <button onClick={() => setEditing(true)} className="text-left text-deep-black hover:text-wine-red truncate" title="Click to edit">
        {initial}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setValue(initial) } }}
        className="w-40 px-1.5 py-0.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
        disabled={saving}
      />
      <button onClick={save} disabled={saving} className="text-[10px] px-1.5 py-0.5 bg-wine-red text-warm-white rounded-sm disabled:opacity-50">{saving ? '…' : '✓'}</button>
      <button onClick={() => { setEditing(false); setValue(initial); setErr(null) }} disabled={saving} className="text-[10px] text-graphite hover:text-wine-red">✕</button>
      {err && <span className="text-[10px] text-wine-red ml-1">{err}</span>}
    </span>
  )
}

// Renders a row's amount as either "฿X" (fixed) or "X% rev" (pct of revenue).
// Inline editor lets the owner switch type and edit the value in one place.
export function AmountCell({ id, amountThb, percentRevenue }: {
  id: string; amountThb: number | null; percentRevenue: number | null
}) {
  const router = useRouter()
  const isPct = percentRevenue != null
  const initialValue = isPct ? String(percentRevenue) : String(amountThb ?? 0)
  const [kind, setKind] = useState<'fixed' | 'pct'>(isPct ? 'pct' : 'fixed')
  const [value, setValue] = useState(initialValue)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) { setErr('≥ 0'); return }
    if (kind === 'pct' && n > 100) { setErr('≤ 100'); return }
    setSaving(true); setErr(null)
    try {
      const payload = kind === 'pct'
        ? { id, percent_revenue: n }
        : { id, amount_thb: n }
      const res = await fetch(API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
      <button onClick={() => setEditing(true)} className="text-right tabular-nums text-deep-black hover:text-wine-red" title="Click to edit">
        {isPct
          ? <>{Number(percentRevenue).toLocaleString('en-US')}<span className="text-graphite text-xs ml-0.5">% rev</span></>
          : <>฿{Math.round(Number(amountThb ?? 0)).toLocaleString('en-US')}</>}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 justify-end">
      <span className="inline-flex border border-pale-stone rounded-sm overflow-hidden text-[10px]">
        <button
          type="button"
          onClick={() => setKind('fixed')}
          className={`px-1.5 py-0.5 ${kind === 'fixed' ? 'bg-wine-red text-warm-white' : 'bg-warm-white text-graphite'}`}
        >฿</button>
        <button
          type="button"
          onClick={() => setKind('pct')}
          className={`px-1.5 py-0.5 ${kind === 'pct' ? 'bg-wine-red text-warm-white' : 'bg-warm-white text-graphite'}`}
        >%</button>
      </span>
      <input
        type="number" min={0} step={kind === 'pct' ? 0.1 : 100} max={kind === 'pct' ? 100 : undefined} autoFocus
        value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setValue(initialValue); setKind(isPct ? 'pct' : 'fixed') } }}
        className="w-24 px-1.5 py-0.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
        disabled={saving}
      />
      <button onClick={save} disabled={saving} className="text-[10px] px-1.5 py-0.5 bg-wine-red text-warm-white rounded-sm disabled:opacity-50">{saving ? '…' : '✓'}</button>
      <button onClick={() => { setEditing(false); setValue(initialValue); setKind(isPct ? 'pct' : 'fixed'); setErr(null) }} disabled={saving} className="text-[10px] text-graphite hover:text-wine-red">✕</button>
      {err && <span className="text-[10px] text-wine-red ml-1">{err}</span>}
    </span>
  )
}

export function BufferCell({ initial }: { initial: number }) {
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
      const res = await fetch('/api/m/pulse-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixed_buffer_pct: n }),
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
      <button onClick={() => setEditing(true)} className="font-display text-2xl tracking-display text-deep-black leading-none hover:text-wine-red" title="Click to edit">
        {initial.toLocaleString('en-US')}<span className="text-graphite text-lg ml-0.5">%</span>
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number" min={0} step={1} max={100} autoFocus
        value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setValue(String(initial)) } }}
        className="w-20 px-1.5 py-0.5 text-base border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
        disabled={saving}
      />
      <button onClick={save} disabled={saving} className="text-[10px] px-1.5 py-0.5 bg-wine-red text-warm-white rounded-sm disabled:opacity-50">{saving ? '…' : '✓'}</button>
      <button onClick={() => { setEditing(false); setValue(String(initial)); setErr(null) }} disabled={saving} className="text-[10px] text-graphite hover:text-wine-red">✕</button>
      {err && <span className="text-[10px] text-wine-red ml-1">{err}</span>}
    </span>
  )
}

export function ActiveCell({ id, initial }: { id: string; initial: boolean }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  async function toggle() {
    setSaving(true)
    try {
      const res = await fetch(API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active: !initial }),
      })
      if (res.ok) router.refresh()
    } finally { setSaving(false) }
  }
  return (
    <button
      onClick={toggle} disabled={saving}
      className={`text-xs px-2 py-0.5 rounded-sm border transition-colors disabled:opacity-50 ${
        initial
          ? 'bg-graphite/10 text-deep-black border-pale-stone hover:border-wine-red'
          : 'bg-cream text-graphite border-pale-stone hover:border-wine-red'
      }`}
      title={initial ? 'Counted in monthly fixed (click to disable)' : 'Excluded from monthly fixed (click to enable)'}
    >
      {initial ? 'Active' : 'Off'}
    </button>
  )
}

export function DeleteCell({ id, category }: { id: string; category: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function del() {
    if (!confirm(`Delete "${category}"?`)) return
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

export function NewCostRow() {
  const router = useRouter()
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<'fixed' | 'pct'>('fixed')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    const n = Number(amount)
    if (!category.trim()) { setErr('category'); return }
    if (!Number.isFinite(n) || n < 0) { setErr('amount ≥ 0'); return }
    if (kind === 'pct' && n > 100) { setErr('% ≤ 100'); return }
    setSaving(true); setErr(null)
    try {
      const payload: Record<string, unknown> = { category: category.trim() }
      if (kind === 'pct') payload.percent_revenue = n
      else payload.amount_thb = n
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setCategory(''); setAmount(''); setKind('fixed'); router.refresh()
    } catch (e: any) { setErr(e?.message ?? 'add failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="flex items-center gap-2 mt-4 p-3 bg-cream/40 border border-pale-stone rounded-sm">
      <input
        placeholder="Category (Rent, Payroll, Tax, …)"
        value={category} onChange={e => setCategory(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        className="flex-1 px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
        disabled={saving}
      />
      <span className="inline-flex border border-pale-stone rounded-sm overflow-hidden text-[10px]">
        <button
          type="button"
          onClick={() => setKind('fixed')}
          className={`px-2 py-1 ${kind === 'fixed' ? 'bg-wine-red text-warm-white' : 'bg-warm-white text-graphite'}`}
        >฿</button>
        <button
          type="button"
          onClick={() => setKind('pct')}
          className={`px-2 py-1 ${kind === 'pct' ? 'bg-wine-red text-warm-white' : 'bg-warm-white text-graphite'}`}
        >%</button>
      </span>
      <input
        type="number" min={0} step={kind === 'pct' ? 0.1 : 100} max={kind === 'pct' ? 100 : undefined}
        placeholder={kind === 'pct' ? '% of revenue' : 'THB / month'}
        value={amount} onChange={e => setAmount(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        className="w-32 px-2 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red text-right tabular-nums"
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
