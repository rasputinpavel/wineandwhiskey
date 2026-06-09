'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { fmtThb } from '@/lib/kpi'
import { DataTable, type Col } from '@/components/shared/DataTable'
import type { RollingWeek } from '@/lib/rolling'
import type { RollingBigPayment } from '@/lib/supabase'

const API = '/api/m/rolling/payment'

// ─── Weekly forecast table ───────────────────────────────────────────────────

export function WeeklyTable({ weeks }: { weeks: RollingWeek[] }) {
  const num = (v: number) => <span className="tabular-nums text-graphite">{v ? fmtThb(v) : '—'}</span>
  const cols: Col<RollingWeek>[] = [
    { key: 'week', header: 'Week', sort: w => w.start, text: w => w.label, cell: w => <span className="text-deep-black whitespace-nowrap">{w.label}</span> },
    { key: 'opening', header: 'Opening', align: 'right', sort: w => w.opening, cell: w => <span className={`tabular-nums ${w.opening < 0 ? 'text-wine-red' : 'text-graphite'}`}>{fmtThb(w.opening)}</span> },
    { key: 'retail', header: 'Retail', align: 'right', sort: w => w.retailProj, cell: w => num(w.retailProj) },
    { key: 'ar', header: 'AR in', align: 'right', sort: w => w.ar, cell: w => num(w.ar) },
    { key: 'owner', header: 'Owner in', align: 'right', sort: w => w.ownerIntake, cell: w => <span className="tabular-nums text-amber-gold">{w.ownerIntake ? '+' + fmtThb(w.ownerIntake) : '—'}</span> },
    { key: 'ap', header: 'Supplier', align: 'right', sort: w => w.ap, cell: w => <span className="tabular-nums text-wine-red">{w.ap ? '−' + fmtThb(w.ap) : '—'}</span> },
    { key: 'fixed', header: 'Fixed', align: 'right', sort: w => w.fixed, cell: w => <span className="tabular-nums text-wine-red">{w.fixed ? '−' + fmtThb(w.fixed) : '—'}</span> },
    { key: 'big', header: 'Big', align: 'right', sort: w => w.big, cell: w => <span className="tabular-nums text-wine-red">{w.big ? '−' + fmtThb(w.big) : '—'}</span> },
    { key: 'closing', header: 'Closing', align: 'right', sort: w => w.closing, cell: w => <span className={`tabular-nums font-medium ${w.closing < 0 ? 'text-wine-red' : 'text-deep-black'}`}>{fmtThb(w.closing)}</span> },
  ]
  return (
    <section className="bg-warm-white border border-pale-stone rounded-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-pale-stone flex items-baseline justify-between">
        <h3 className="font-heading text-base text-deep-black">Weekly forecast</h3>
        <span className="text-[11px] text-graphite">{weeks.length} weeks to year-end</span>
      </div>
      <DataTable rows={weeks} cols={cols} rowKey={w => w.start} initialSortKey="week" initialSortDir="asc" searchPlaceholder="Search week…" />
    </section>
  )
}

// ─── Big payments panel (form + editable list) ───────────────────────────────

export function BigPaymentsPanel({ payments }: { payments: RollingBigPayment[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    if (!name.trim()) { setErr('name'); return }
    const amt = Number(amount.replace(',', '.'))
    if (!Number.isFinite(amt) || amt <= 0) { setErr('amount'); return }
    setSaving(true); setErr(null)
    try {
      const res = await fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), amount: amt, due_date: date || null }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`) }
      setName(''); setAmount(''); setDate(''); router.refresh()
    } catch (e: unknown) { setErr((e as { message?: string })?.message ?? 'failed') }
    finally { setSaving(false) }
  }

  return (
    <section className="bg-warm-white border border-pale-stone rounded-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-pale-stone">
        <h3 className="font-heading text-base text-deep-black">Big payments</h3>
        <p className="text-[11px] text-graphite mt-0.5">One-off / annual outflows (licence, visa, deposits). Subtracted on their week unless marked paid.</p>
      </div>

      <div className="px-4 py-3 flex flex-wrap items-end gap-3 border-b border-pale-stone">
        <Field label="Name">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Visa"
            className="w-40 px-2 py-1.5 text-sm border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red" />
        </Field>
        <Field label="Amount ฿">
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0"
            className="w-28 px-2 py-1.5 text-sm border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red" />
        </Field>
        <Field label="Due date">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-2 py-1.5 text-sm border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red" />
        </Field>
        <button onClick={add} disabled={saving}
          className="px-4 py-1.5 text-sm bg-wine-red text-warm-white rounded-sm disabled:opacity-50 hover:bg-burgundy-deep transition-colors">
          {saving ? '…' : 'Add'}
        </button>
        {err && <span className="text-xs text-wine-red self-center">{err}</span>}
      </div>

      <table className="w-full text-sm">
        <tbody>
          {payments.map(p => <BigPaymentRow key={p.id} p={p} />)}
          {payments.length === 0 && (
            <tr><td className="px-4 py-5 text-center text-graphite" colSpan={5}>No big payments.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

function BigPaymentRow({ p }: { p: RollingBigPayment }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function patch(body: Record<string, unknown>) {
    setBusy(true)
    try {
      const res = await fetch(API, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, ...body }) })
      if (res.ok) router.refresh()
    } finally { setBusy(false) }
  }
  async function del() {
    if (!confirm(`Delete "${p.name}"?`)) return
    setBusy(true)
    try { const res = await fetch(`${API}?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' }); if (res.ok) router.refresh() }
    finally { setBusy(false) }
  }

  const paid = p.status === 'paid'
  return (
    <tr className="border-b border-pale-stone/50 last:border-0 hover:bg-cream/40">
      <td className="px-4 py-2 text-deep-black">{p.name}</td>
      <td className="px-2 py-2 text-right tabular-nums text-wine-red whitespace-nowrap">−{fmtThb(p.amount)}</td>
      <td className="px-2 py-2">
        <input type="date" defaultValue={p.due_date ?? ''} disabled={busy}
          onChange={e => patch({ due_date: e.target.value || null })}
          className="px-1.5 py-0.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red" />
      </td>
      <td className="px-2 py-2">
        <button onClick={() => patch({ status: paid ? 'planned' : 'paid' })} disabled={busy}
          className={`text-[11px] px-2 py-0.5 rounded-sm ${paid ? 'bg-cream text-graphite' : 'bg-amber-gold/20 text-amber-gold'}`}>
          {paid ? '✓ paid' : 'planned'}
        </button>
      </td>
      <td className="px-4 py-2 text-right w-8">
        <button onClick={del} disabled={busy} title="Delete" className="text-graphite hover:text-wine-red text-xs">✕</button>
      </td>
    </tr>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="overline text-graphite">{label}</span>
      {children}
    </label>
  )
}
