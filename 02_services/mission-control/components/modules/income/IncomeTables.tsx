'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { fmtThb } from '@/lib/kpi'
import type { DayBreakdown, DayCell } from '@/lib/income'
import { DeleteMovementButton } from './IncomeControls'

// ─── Generic sortable + searchable table ─────────────────────────────────────
// Reusable across the portal: click a header to sort (toggles asc/desc), type to
// filter across searchable columns. Server builds plain rows; columns (with
// render fns) are defined inside this client component.

export type Col<T> = {
  key: string
  header: string
  align?: 'left' | 'right'
  sort?: (row: T) => string | number   // omit → column not sortable
  text?: (row: T) => string             // included in the search box
  cell: (row: T) => ReactNode
}

export function DataTable<T>({
  rows, cols, rowKey, initialSortKey, initialSortDir = 'desc',
  searchPlaceholder = 'Search…', empty = 'No entries.',
}: {
  rows: T[]
  cols: Col<T>[]
  rowKey: (row: T, i: number) => string
  initialSortKey?: string
  initialSortDir?: 'asc' | 'desc'
  searchPlaceholder?: string
  empty?: string
}) {
  const [q, setQ] = useState('')
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey)
  const [dir, setDir] = useState<'asc' | 'desc'>(initialSortDir)

  const searchable = cols.filter(c => c.text)
  const view = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = needle
      ? rows.filter(r => searchable.some(c => (c.text!(r) ?? '').toLowerCase().includes(needle)))
      : rows.slice()
    const col = sortKey ? cols.find(c => c.key === sortKey) : undefined
    if (col?.sort) {
      out.sort((a, b) => {
        const av = col.sort!(a), bv = col.sort!(b)
        return av < bv ? -1 : av > bv ? 1 : 0
      })
      if (dir === 'desc') out.reverse()
    }
    return out
  }, [rows, q, sortKey, dir]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSort(c: Col<T>) {
    if (!c.sort) return
    if (sortKey === c.key) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(c.key); setDir('asc') }
  }

  return (
    <div>
      {searchable.length > 0 && (
        <div className="px-4 py-2 border-b border-pale-stone">
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder={searchPlaceholder}
            className="w-full max-w-xs px-2 py-1.5 text-sm border border-pale-stone rounded-sm focus:outline-none focus:border-wine-red"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-graphite border-b border-pale-stone">
              {cols.map(c => (
                <th key={c.key}
                  onClick={() => toggleSort(c)}
                  className={`px-3 py-2 font-normal overline ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.sort ? 'cursor-pointer select-none hover:text-deep-black' : ''}`}>
                  {c.header}{c.sort && sortKey === c.key ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r, i) => (
              <tr key={rowKey(r, i)} className="border-b border-pale-stone/50 last:border-0 hover:bg-cream/40">
                {cols.map(c => (
                  <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
            {view.length === 0 && (
              <tr><td className="px-4 py-6 text-center text-graphite" colSpan={cols.length}>{empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Ledger (collapsed by default) ───────────────────────────────────────────

export type LedgerRowData = {
  date: string
  label: string
  tag: string
  amount: number        // signed, for numeric sort
  amountText: string
  negative: boolean
  manualId: string | null
}

export function LedgerTable({ rows }: { rows: LedgerRowData[] }) {
  const cols: Col<LedgerRowData>[] = [
    { key: 'date', header: 'Date', sort: r => r.date, text: r => r.date, cell: r => <span className="text-graphite">{r.date}</span> },
    { key: 'label', header: 'Description', sort: r => r.label.toLowerCase(), text: r => r.label, cell: r => <span className="text-deep-black">{r.label}</span> },
    { key: 'tag', header: 'Wallet', sort: r => r.tag, text: r => r.tag, cell: r => <span className="text-[11px] text-graphite bg-cream rounded-sm px-1.5 py-0.5">{r.tag}</span> },
    { key: 'amount', header: 'Amount', align: 'right', sort: r => r.amount, cell: r => <span className={r.negative ? 'text-wine-red' : 'text-deep-black'}>{r.amountText}</span> },
    { key: 'del', header: '', align: 'right', cell: r => (r.manualId ? <DeleteMovementButton id={r.manualId} /> : null) },
  ]
  return (
    <details className="bg-warm-white border border-pale-stone rounded-sm overflow-hidden">
      <summary className="px-4 py-3 cursor-pointer select-none flex items-baseline justify-between">
        <span className="font-heading text-base text-deep-black">Ledger</span>
        <span className="text-[11px] text-graphite">manual + expenses (from sheet) · {rows.length} entries</span>
      </summary>
      <div className="border-t border-pale-stone">
        <DataTable rows={rows} cols={cols} rowKey={(r, i) => r.manualId ?? `e${i}`} initialSortKey="date" initialSortDir="desc" searchPlaceholder="Search ledger…" />
      </div>
    </details>
  )
}

// ─── Daily breakdown (collapsed by default) ──────────────────────────────────

function DayWalletCell({ c }: { c: DayCell }) {
  return (
    <>
      <span className={`tabular-nums ${c.balance < 0 ? 'text-wine-red' : 'text-deep-black'}`}>{fmtThb(c.balance)}</span>
      {c.delta !== 0 && (
        <span className={`ml-1.5 text-[10px] tabular-nums ${c.delta < 0 ? 'text-wine-red' : 'text-graphite'}`}>
          {c.delta > 0 ? '+' : '−'}{fmtThb(Math.abs(c.delta)).replace('฿', '')}
        </span>
      )}
    </>
  )
}

export function DailyTable({ days }: { days: DayBreakdown[] }) {
  const cols: Col<DayBreakdown>[] = [
    { key: 'date', header: 'Date', sort: d => d.date, text: d => d.date, cell: d => <span className="text-graphite">{d.date}</span> },
    { key: 'account', header: 'Account', align: 'right', sort: d => d.account.balance, cell: d => <DayWalletCell c={d.account} /> },
    { key: 'cash', header: 'Cash', align: 'right', sort: d => d.cash.balance, cell: d => <DayWalletCell c={d.cash} /> },
    { key: 'personal', header: 'Personal', align: 'right', sort: d => d.personal.balance, cell: d => <DayWalletCell c={d.personal} /> },
    { key: 'total', header: 'Total', align: 'right', sort: d => d.total, cell: d => <span className={`font-medium ${d.total < 0 ? 'text-wine-red' : 'text-deep-black'}`}>{fmtThb(d.total)}</span> },
  ]
  return (
    <details className="bg-warm-white border border-pale-stone rounded-sm overflow-hidden">
      <summary className="px-4 py-3 cursor-pointer select-none flex items-baseline justify-between">
        <span className="font-heading text-base text-deep-black">Daily breakdown</span>
        <span className="text-[11px] text-graphite">{days.length} days · running balance per wallet</span>
      </summary>
      <div className="border-t border-pale-stone">
        <DataTable rows={days} cols={cols} rowKey={d => d.date} initialSortKey="date" initialSortDir="desc" searchPlaceholder="Search day…" />
      </div>
    </details>
  )
}
