'use client'

import { useEffect, useState } from 'react'

type Row = {
  id: string
  item_name: string
  qty: number
  taken_date: string
  taken_by: string | null
  status: string
  closed_at: string | null
  closed_by: string | null
}

// Render a 'YYYY-MM-DD' date as DD.MM.YYYY; pass through anything else.
function fmtD(d: string): string {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d
}

function ageDays(takenDate: string): number {
  const a = new Date(takenDate + 'T12:00:00Z').getTime()
  const b = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z').getTime()
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

// Bottles taken "себе", pending a Loyverse Stock Adjustment. Rows are written
// by the Chip & Dale bot (migration 039_stock_writeoffs); a manager closes a
// row here once the adjustment has actually been made in Loyverse — the bot
// never writes to Loyverse itself.
export default function WriteoffsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [loading, setLoading] = useState(true)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/m/writeoffs?status=${filter}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setRows(json.rows ?? [])
    } catch (e: any) {
      setErr(e?.message ?? 'failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  async function close(id: string) {
    setClosingId(id)
    setErr(null)
    try {
      const res = await fetch('/api/m/writeoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      await load()
    } catch (e: any) {
      setErr(e?.message ?? 'save failed')
    } finally {
      setClosingId(null)
    }
  }

  return (
    // This route has no module layout, so it must provide its own vertical
    // scroll: the AppShell content column is `h-screen overflow-hidden`, and a
    // plain padded div would clip the list instead of scrolling it.
    <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Write-offs</h1>
        <p className="text-sm text-neutral-500">
          Bottles taken from stock, pending a Loyverse Stock Adjustment. Заводит бот Chip &amp; Dale; закрывайте кнопкой, когда корректировка в Loyverse уже сделана.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <button
          onClick={() => setFilter('pending')}
          disabled={filter === 'pending'}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Pending
        </button>
        <button
          onClick={() => setFilter('all')}
          disabled={filter === 'all'}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:border-blue-500 disabled:opacity-50 disabled:hover:border-neutral-300"
        >
          All
        </button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="py-2 pr-4">Item</th>
              <th className="py-2 pr-4 text-right">Qty</th>
              <th className="py-2 pr-4">Date</th>
              <th className="py-2 pr-4">Age</th>
              <th className="py-2 pr-4">By</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-neutral-400">Loading…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-neutral-400">Nothing here.</td>
              </tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100">
                <td className="py-2 pr-4 font-medium">{r.item_name}</td>
                <td className="py-2 pr-4 text-right">{r.qty}</td>
                <td className="py-2 pr-4">{fmtD(r.taken_date)}</td>
                <td className="py-2 pr-4">{r.status === 'pending' ? `${ageDays(r.taken_date)}d` : '—'}</td>
                <td className="py-2 pr-4">{r.taken_by ?? '—'}</td>
                <td className="py-2 pr-4">
                  {r.status === 'pending'
                    ? <span className="text-amber-gold">⏳ pending</span>
                    : <span className="text-neutral-500">✅ done</span>}
                </td>
                <td className="py-2 pr-4">
                  {r.status === 'pending' && (
                    <button
                      onClick={() => close(r.id)}
                      disabled={closingId === r.id}
                      className="rounded bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      {closingId === r.id ? '…' : '✅ Списано'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
