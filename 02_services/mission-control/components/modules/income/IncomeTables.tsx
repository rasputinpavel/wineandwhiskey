'use client'

import { fmtThb } from '@/lib/kpi'
import type { DayBreakdown, DayCell } from '@/lib/income'
import { DataTable, type Col } from '@/components/shared/DataTable'
import { DeleteMovementButton } from './IncomeControls'

// ─── Ledger (collapsed by default) ───────────────────────────────────────────

export type LedgerRowData = {
  date: string
  label: string
  tag: string
  amount: number        // signed, for numeric sort
  amountText: string
  negative: boolean
  owner: boolean        // owner financing — visually highlighted
  manualId: string | null
}

export function LedgerTable({ rows }: { rows: LedgerRowData[] }) {
  const cols: Col<LedgerRowData>[] = [
    { key: 'date', header: 'Date', sort: r => r.date, text: r => r.date, cell: r => <span className="text-graphite">{r.date}</span> },
    { key: 'label', header: 'Description', sort: r => r.label.toLowerCase(), text: r => r.label, cell: r => <span className={r.owner ? 'text-amber-gold font-medium' : 'text-deep-black'}>{r.label}</span> },
    { key: 'tag', header: 'Wallet', sort: r => r.tag, text: r => r.tag, cell: r => <span className={`text-[11px] rounded-sm px-1.5 py-0.5 ${r.owner ? 'text-amber-gold bg-amber-gold/15' : 'text-graphite bg-cream'}`}>{r.tag}</span> },
    { key: 'amount', header: 'Amount', align: 'right', sort: r => r.amount, cell: r => <span className={r.owner ? 'text-amber-gold' : r.negative ? 'text-wine-red' : 'text-deep-black'}>{r.amountText}</span> },
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
