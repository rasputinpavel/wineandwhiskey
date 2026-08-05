import { sbPublic, type PoScan } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { signScanUrls } from '@/lib/po/scans'

export const dynamic = 'force-dynamic'

type SearchParams = { q?: string; from?: string; to?: string }

// Render a 'YYYY-MM-DD' date as DD.MM.YYYY; pass through anything else.
function fmtD(d: string | null): string {
  if (!d) return '—'
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d
}

function fmtAmount(n: number | null): string {
  return n == null ? '—' : `฿${Math.round(n).toLocaleString('en-US')}`
}

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  const from = (sp.from ?? '').trim()
  const to = (sp.to ?? '').trim()

  let query = sbPublic
    .from('po_scans')
    .select('*')
    .order('received_date', { ascending: false })
    .limit(500)

  // `q` is interpolated into PostgREST's .or() mini-language, where , ( ) * %
  // are metacharacters. Strip them so a comma/paren in the search box can't
  // break the filter or inject extra conditions (sbPublic bypasses RLS).
  const qFilter = q.replace(/[,()*%\\]/g, ' ').trim()
  if (qFilter) query = query.or(`supplier.ilike.%${qFilter}%,doc_number.ilike.%${qFilter}%`)
  if (from) query = query.gte('order_date', from)
  if (to) query = query.lte('order_date', to)

  const { data, error } = await query
  if (error) {
    return (
      <div className="p-6">
        <SchemaError error={error.message} />
      </div>
    )
  }

  const rows = (data ?? []) as PoScan[]
  const urls = await signScanUrls(rows.map((r) => r.scan_path))

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
          From (order date)
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-500">
          To
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="mt-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
          Apply
        </button>
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
                  No purchase orders yet.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const url = urls.get(r.scan_path)
              return (
                <tr key={r.id} className="border-b border-neutral-100">
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
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
