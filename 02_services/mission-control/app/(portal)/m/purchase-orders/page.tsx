import { Fragment } from 'react'
import { sbPublic, type PoScan } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { signScanUrls } from '@/lib/po/scans'
import { PoRow } from '@/components/modules/po/PoRow'

export const dynamic = 'force-dynamic'

type SearchParams = { q?: string; month?: string; sort?: string; dir?: string }

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Sortable columns → the value each row sorts by. When a sort is active the
// month grouping is switched off (a cross-month ordering has no month buckets).
const SORTS: Record<string, (r: PoScan) => string | number | null> = {
  supplier: (r) => r.supplier?.toLowerCase() ?? null,
  doc_number: (r) => r.doc_number ?? null,
  order_date: (r) => r.order_date ?? null,
  amount_total: (r) => r.amount_total,
}

const COLUMNS: { key: string; label: string; align?: 'right' }[] = [
  { key: 'supplier', label: 'Supplier' },
  { key: 'doc_number', label: '№' },
  { key: 'order_date', label: 'Order date' },
  { key: 'amount_total', label: 'Total', align: 'right' },
]

// asc comparator; blanks/nulls are partitioned out beforehand so they always
// stay last regardless of direction.
function cmpVals(a: string | number | null, b: string | number | null): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const sa = String(a), sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

// The month a PO belongs to — by document date, falling back to received date
// then upload time so a row without an order_date still lands somewhere sane.
function monthKey(r: PoScan): string {
  const d = r.order_date ?? r.received_date ?? r.created_at ?? ''
  return d.slice(0, 7) // 'YYYY-MM'
}

function sortDate(r: PoScan): string {
  return r.order_date ?? r.received_date ?? r.created_at ?? ''
}

function monthLabel(key: string): string {
  const m = key.match(/^(\d{4})-(\d{2})/)
  if (!m) return 'Undated'
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  const month = (sp.month ?? '').trim() // 'YYYY-MM' from <input type="month">
  const sort = (sp.sort ?? '').trim()
  const dir = sp.dir === 'asc' ? 'asc' : 'desc'
  const sortOk = sort in SORTS

  let query = sbPublic
    .from('po_scans')
    .select('*')
    .order('order_date', { ascending: false, nullsFirst: false })
    .limit(500)

  if (q) {
    // Strip PostgREST .or() metachars so a comma/paren can't break the filter.
    const qFilter = q.replace(/[,()*%\\]/g, ' ').trim()
    if (qFilter) query = query.or(`supplier.ilike.%${qFilter}%,doc_number.ilike.%${qFilter}%`)
  }

  const monthOk = /^\d{4}-\d{2}$/.test(month)
  if (monthOk) {
    const start = `${month}-01`
    const [y, m] = month.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
    query = query.gte('order_date', start).lt('order_date', next)
  }

  const { data, error } = await query
  if (error) {
    return (
      <div className="p-6">
        <SchemaError error={error.message} />
      </div>
    )
  }

  const all = (data ?? []) as PoScan[]
  let rows: PoScan[]
  if (sortOk) {
    const val = SORTS[sort]
    const blank = (v: string | number | null) => v == null || v === ''
    const filled = all.filter((r) => !blank(val(r)))
    const blanks = all.filter((r) => blank(val(r)))
    filled.sort((a, b) => cmpVals(val(a), val(b)))
    if (dir === 'desc') filled.reverse()
    rows = [...filled, ...blanks] // blanks always last
  } else {
    rows = all.sort((a, b) => {
      const ka = monthKey(a), kb = monthKey(b)
      if (ka !== kb) return ka < kb ? 1 : -1 // month desc
      return sortDate(a) < sortDate(b) ? 1 : -1 // within month, date desc
    })
  }

  const urls = await signScanUrls(rows.map((r) => r.scan_path))

  // Show month separators only in the default view — no month filter, no sort.
  const grouped = !monthOk && !sortOk

  // Build a header link that toggles this column's direction, preserving the
  // active search/month filter. First click on a column sorts ascending.
  const sortHref = (col: string) => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (monthOk) p.set('month', month)
    p.set('sort', col)
    p.set('dir', sortOk && sort === col && dir === 'asc' ? 'desc' : 'asc')
    return `/m/purchase-orders?${p.toString()}`
  }

  return (
    // This route has no module layout, so it must provide its own vertical
    // scroll: the AppShell content column is `h-screen overflow-hidden`, and a
    // plain padded div would clip the list instead of scrolling it.
    <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Purchase Orders</h1>
        <p className="text-sm text-neutral-500">
          Scanned supplier POs. Search by supplier or document number; click a column to sort, ✎ to correct a row, open a scan to retrieve the copy.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-neutral-500">
          Search
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="supplier or № …"
            className="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-500">
          Month
          <input
            type="month"
            name="month"
            defaultValue={monthOk ? month : ''}
            className="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
          Apply
        </button>
        {(q || monthOk || sortOk) && (
          <a href="/m/purchase-orders" className="px-2 py-1.5 text-sm text-neutral-500 underline">
            Reset
          </a>
        )}
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              {COLUMNS.map((c) => {
                const active = sortOk && sort === c.key
                const arrow = active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''
                return (
                  <th key={c.key} className={`py-2 pr-4${c.align === 'right' ? ' text-right' : ''}`}>
                    <a
                      href={sortHref(c.key)}
                      className={`hover:text-neutral-800 hover:underline ${active ? 'text-neutral-800 font-medium' : ''}`}
                    >
                      {c.label}{arrow}
                    </a>
                  </th>
                )
              })}
              <th className="py-2 pr-4">Scan</th>
              <th className="py-2 pr-4">Note</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-neutral-400">
                  No purchase orders {monthOk ? 'this month' : 'yet'}.
                </td>
              </tr>
            )}
            {rows.map((r, i) => {
              const showHeader = grouped && (i === 0 || monthKey(r) !== monthKey(rows[i - 1]))
              return (
                <Fragment key={r.id}>
                  {showHeader && (
                    <tr>
                      <td
                        colSpan={7}
                        className="pt-5 pb-1 text-sm font-semibold text-neutral-700 border-b border-neutral-200"
                      >
                        {monthLabel(monthKey(r))}
                      </td>
                    </tr>
                  )}
                  <PoRow row={r} scanUrl={urls.get(r.scan_path)} />
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
