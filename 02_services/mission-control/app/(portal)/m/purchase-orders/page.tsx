import { Fragment } from 'react'
import { sbPublic, type PoScan } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { signScanUrls } from '@/lib/po/scans'

export const dynamic = 'force-dynamic'

type SearchParams = { q?: string; month?: string }

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Render a 'YYYY-MM-DD' date as DD.MM.YYYY; pass through anything else.
function fmtD(d: string | null): string {
  if (!d) return '—'
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d
}

function fmtAmount(n: number | null): string {
  return n == null ? '—' : `฿${Math.round(n).toLocaleString('en-US')}`
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

  const rows = ((data ?? []) as PoScan[]).sort((a, b) => {
    const ka = monthKey(a), kb = monthKey(b)
    if (ka !== kb) return ka < kb ? 1 : -1 // month desc
    return sortDate(a) < sortDate(b) ? 1 : -1 // within month, date desc
  })

  const urls = await signScanUrls(rows.map((r) => r.scan_path))

  // Show month separators only when browsing all months (no month filter).
  const grouped = !monthOk

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Purchase Orders</h1>
        <p className="text-sm text-neutral-500">
          Scanned supplier POs. Search by supplier or document number; open a scan to retrieve the copy.
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
        {(q || monthOk) && (
          <a href="/m/purchase-orders" className="px-2 py-1.5 text-sm text-neutral-500 underline">
            Reset
          </a>
        )}
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="py-2 pr-4">Supplier</th>
              <th className="py-2 pr-4">№</th>
              <th className="py-2 pr-4">Order date</th>
              <th className="py-2 pr-4">Received</th>
              <th className="py-2 pr-4 text-right">Total</th>
              <th className="py-2 pr-4">Scan</th>
              <th className="py-2 pr-4">By</th>
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
              const url = urls.get(r.scan_path)
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
                  <tr className="border-b border-neutral-100">
                    <td className="py-2 pr-4 font-medium">{r.supplier ?? '—'}</td>
                    <td className="py-2 pr-4">{r.doc_number ?? '—'}</td>
                    <td className="py-2 pr-4">{fmtD(r.order_date)}</td>
                    <td className="py-2 pr-4">{fmtD(r.received_date)}</td>
                    <td className="py-2 pr-4 text-right">{fmtAmount(r.amount_total)}</td>
                    <td className="py-2 pr-4">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                          open ↗
                        </a>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-neutral-500">{r.uploaded_by ?? '—'}</td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
