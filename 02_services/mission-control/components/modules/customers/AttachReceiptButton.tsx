'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Candidate = {
  receipt_number: string
  receipt_date: string
  receipt_type: string
  total: number
  payment_method: string | null
  is_b2b: boolean
  b2b_manual: boolean
  customer_name: string | null
  b2b_customer_id: string | null
}

// Attach a Loyverse receipt to this B2B customer by hand.
//
// Needed when a B2B sale was rung up without the customer card and paid by
// cash/card/QR: nothing in the receipt says B2B, so it counts as retail and
// belongs to no client. The receipt can't be fixed in Loyverse after the fact.
export function AttachReceiptButton({ customerId, customerName }: { customerId: string; customerName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Candidate[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/m/receipts?q=${encodeURIComponent(query)}`)
      const j = await res.json()
      setItems(j.items ?? [])
    }, 200)
    return () => clearTimeout(t)
  }, [open, query])

  async function attach(receiptNumber: string) {
    setSaving(true); setErr(null)
    try {
      const res = await fetch('/api/m/receipts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt_number: receiptNumber, b2b_customer_id: customerId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      setOpen(false)
      setQuery('')
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? 'save failed')
    } finally { setSaving(false) }
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        className="text-xs px-2 py-0.5 rounded-sm border bg-warm-white text-graphite border-pale-stone hover:text-wine-red hover:border-wine-red transition-colors disabled:opacity-50"
        title={`Mark a Loyverse receipt as a B2B sale of ${customerName} — for sales rung up without the customer card.`}
      >
        + attach receipt
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-[min(94vw,420px)] bg-warm-white border border-pale-stone rounded-md shadow-card-hover p-2">
          <input
            autoFocus type="search" value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="receipt number, e.g. 5-9217"
            className="w-full px-2 py-1.5 text-xs border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red mb-2"
          />
          <div className="max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <div className="text-[11px] text-graphite px-2 py-2">
                {query ? 'Ничего не нашлось' : 'Введи номер чека'}
              </div>
            ) : items.map(r => {
              const taken = !!r.b2b_customer_id && r.b2b_customer_id !== customerId
              return (
                <button
                  key={r.receipt_number}
                  onClick={() => attach(r.receipt_number)}
                  disabled={saving || taken}
                  className="w-full text-left text-xs px-2 py-1.5 rounded-sm hover:bg-cream text-deep-black disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-mono">{r.receipt_number}</span>
                    <span className="tabular-nums whitespace-nowrap">
                      {r.receipt_type === 'REFUND' ? '−' : ''}฿{Math.round(Number(r.total)).toLocaleString('en-US')}
                    </span>
                  </div>
                  <div className="text-[10px] text-graphite">
                    {String(r.receipt_date).slice(0, 10)}
                    {r.payment_method ? ` · ${r.payment_method}` : ''}
                    {r.customer_name ? ` · ${r.customer_name}` : r.is_b2b ? ' · B2B' : ' · retail'}
                    {taken ? ' · уже привязан к другому клиенту' : ''}
                  </div>
                </button>
              )
            })}
          </div>
          {err && <div className="text-[10px] text-wine-red mt-1 px-2">{err}</div>}
        </div>
      )}
    </div>
  )
}
