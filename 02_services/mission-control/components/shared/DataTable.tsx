'use client'

import { useMemo, useState, type ReactNode } from 'react'

// ─── Generic sortable + searchable table ─────────────────────────────────────
// Portal baseline: click a header to sort (toggles asc/desc), type to filter
// across searchable columns. Server builds plain rows; columns (with render
// fns) are defined inside a client component that wraps this one.

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
  searchPlaceholder = 'Search…', empty = 'No entries.', rowClassName,
}: {
  rows: T[]
  cols: Col<T>[]
  rowKey: (row: T, i: number) => string
  initialSortKey?: string
  initialSortDir?: 'asc' | 'desc'
  searchPlaceholder?: string
  empty?: string
  rowClassName?: (row: T, i: number) => string   // per-row tint, e.g. plan vs fact
}) {
  const [q, setQ] = useState('')
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey)
  const [dir, setDir] = useState<'asc' | 'desc'>(initialSortDir)

  const searchable = cols.filter(c => c.text)
  const view = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = needle
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
              <tr key={rowKey(r, i)} className={`border-b border-pale-stone/50 last:border-0 hover:bg-cream/40 ${rowClassName?.(r, i) ?? ''}`}>
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
