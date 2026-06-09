'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WalletId } from '@/lib/supabase'

const MV_API = '/api/m/income/movement'
const W_API = '/api/m/income/wallet'

const WALLET_OPTS: { id: WalletId; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'cash', label: 'Cash' },
  { id: 'personal', label: 'Personal' },
]

type Kind = 'inflow' | 'transfer' | 'outflow'

// ─── Add-movement form ───────────────────────────────────────────────────────

export function MovementForm({ today }: { today: string }) {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>('inflow')
  const [amount, setAmount] = useState('')
  const [wallet, setWallet] = useState<WalletId>('cash')
  const [from, setFrom] = useState<WalletId>('cash')
  const [to, setTo] = useState<WalletId>('account')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [owner, setOwner] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    const amt = Number(amount.replace(',', '.'))
    if (!Number.isFinite(amt) || amt <= 0) { setErr('amount must be > 0'); return }
    if (kind === 'transfer' && from === to) { setErr('transfer wallets must differ'); return }
    setSaving(true); setErr(null)
    const body =
      kind === 'transfer'
        ? { occurred_on: date, kind, amount: amt, from_wallet_id: from, to_wallet_id: to, note }
        : { occurred_on: date, kind, amount: amt, wallet_id: wallet, note, owner_contribution: kind === 'inflow' && owner }
    try {
      const res = await fetch(MV_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`) }
      setAmount(''); setNote(''); router.refresh()
    } catch (e: unknown) { setErr((e as { message?: string })?.message ?? 'save failed') }
    finally { setSaving(false) }
  }

  const tab = (k: Kind, label: string) => (
    <button
      type="button" onClick={() => { setKind(k); setErr(null) }}
      className={`px-3 py-1.5 text-sm rounded-sm transition-colors ${kind === k ? 'bg-wine-red text-warm-white' : 'text-graphite hover:bg-cream'}`}
    >{label}</button>
  )

  return (
    <div className="bg-warm-white border border-pale-stone rounded-sm p-4">
      <div className="flex gap-1 mb-3">
        {tab('inflow', '+ Income')}
        {tab('transfer', '⇄ Transfer')}
        {tab('outflow', '− Withdraw')}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Amount ฿">
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0"
            className="w-28 px-2 py-1.5 text-sm border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red" />
        </Field>

        {kind === 'transfer' ? (
          <>
            <Field label="From"><WalletSelect value={from} onChange={setFrom} /></Field>
            <Field label="To"><WalletSelect value={to} onChange={setTo} /></Field>
          </>
        ) : (
          <Field label="Wallet"><WalletSelect value={wallet} onChange={setWallet} /></Field>
        )}

        <Field label="Date">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-2 py-1.5 text-sm border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red" />
        </Field>

        <Field label="Note">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="optional"
            className="w-44 px-2 py-1.5 text-sm border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red" />
        </Field>

        {kind === 'inflow' && (
          <label className="flex items-center gap-1.5 self-center text-xs text-graphite cursor-pointer select-none">
            <input type="checkbox" checked={owner} onChange={e => setOwner(e.target.checked)} className="accent-amber-gold" />
            Owner contribution
          </label>
        )}

        <button onClick={submit} disabled={saving}
          className="px-4 py-1.5 text-sm bg-wine-red text-warm-white rounded-sm disabled:opacity-50 hover:bg-burgundy-deep transition-colors">
          {saving ? 'Saving…' : 'Add'}
        </button>
        {err && <span className="text-xs text-wine-red self-center">{err}</span>}
      </div>

      <p className="text-[11px] text-graphite mt-2">
        {kind === 'inflow' && 'Money coming in — pick which wallet it lands in.'}
        {kind === 'transfer' && 'Move money between wallets (e.g. take cash from the register and deposit it to the account). Not an income.'}
        {kind === 'outflow' && 'Money leaving a wallet that is not a logged expense (e.g. owner withdrawal).'}
      </p>
    </div>
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

function WalletSelect({ value, onChange }: { value: WalletId; onChange: (w: WalletId) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as WalletId)}
      className="px-2 py-1.5 text-sm border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red bg-warm-white">
      {WALLET_OPTS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  )
}

// ─── Delete a manual movement ────────────────────────────────────────────────

export function DeleteMovementButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function del() {
    if (!confirm('Delete this movement?')) return
    setBusy(true)
    try {
      const res = await fetch(`${MV_API}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (res.ok) router.refresh()
    } finally { setBusy(false) }
  }
  return (
    <button onClick={del} disabled={busy} title="Delete"
      className="text-graphite hover:text-wine-red disabled:opacity-50 text-xs">✕</button>
  )
}

// ─── Edit a wallet's opening balance / date ──────────────────────────────────

export function WalletOpeningCell({ id, balance, date }: { id: WalletId; balance: number; date: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [bal, setBal] = useState(String(balance))
  const [d, setD] = useState(date)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const n = Number(bal.replace(',', '.'))
    if (!Number.isFinite(n)) { setErr('number'); return }
    setSaving(true); setErr(null)
    try {
      const res = await fetch(W_API, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, opening_balance: n, opening_date: d }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || `HTTP ${res.status}`) }
      setEditing(false); router.refresh()
    } catch (e: unknown) { setErr((e as { message?: string })?.message ?? 'failed') }
    finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-[11px] text-graphite hover:text-wine-red" title="Edit opening balance">
        opening ฿{Math.round(balance).toLocaleString('en-US')} · {date} ✎
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-overline text-graphite">Opening ฿</span>
        <input value={bal} onChange={e => setBal(e.target.value)} inputMode="decimal" autoFocus
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setBal(String(balance)); setD(date); setErr(null) } }}
          className="w-full px-1.5 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red" />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-overline text-graphite">As of</span>
        <input type="date" value={d} onChange={e => setD(e.target.value)}
          className="w-full px-1.5 py-1 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red" />
      </label>
      <div className="flex items-center gap-1.5">
        <button onClick={save} disabled={saving} className="text-[11px] px-2 py-1 bg-wine-red text-warm-white rounded-sm disabled:opacity-50 hover:bg-burgundy-deep">{saving ? '…' : 'Save'}</button>
        <button onClick={() => { setEditing(false); setBal(String(balance)); setD(date); setErr(null) }} disabled={saving} className="text-[11px] px-2 py-1 text-graphite hover:text-wine-red">Cancel</button>
        {err && <span className="text-[10px] text-wine-red">{err}</span>}
      </div>
    </div>
  )
}
