import { sbInventory } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { MapLineCell } from '@/components/modules/inventory/MapLineCell'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { SortHeader, readSortParams, cmpBy } from '@/components/shell/SortHeader'
import { fmtDate } from '@/lib/fmt'

export const dynamic = 'force-dynamic'

type UnmappedRow = {
  id: string
  raw_text: string
  qty: number
  amount: number | null
  invoice_id: string
  flowaccount_invoice: { number: string; customer_name: string; issued_at: string } | null
}

type SearchParams = Record<string, string | undefined>

export default async function UnmappedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { data, error } = await sbInventory
    .from('flowaccount_invoice_line')
    .select('id, raw_text, qty, amount, invoice_id, flowaccount_invoice(number, customer_name, issued_at)')
    .is('sku_id', null)
    .limit(200)

  if (error) return <SchemaError error={error.message} />
  const rows = (data ?? []) as unknown as UnmappedRow[]

  const { sort, dir } = readSortParams(
    sp,
    ['issued_at','number','customer_name','raw_text','qty','amount'] as const,
    'issued_at',
  )
  const sortedRows = [...rows].sort(cmpBy(r => {
    if (sort === 'qty')    return Number(r.qty ?? 0)
    if (sort === 'amount') return Number(r.amount ?? 0)
    if (sort === 'raw_text')      return r.raw_text ?? ''
    if (sort === 'issued_at')     return r.flowaccount_invoice?.issued_at ?? ''
    if (sort === 'number')        return r.flowaccount_invoice?.number ?? ''
    if (sort === 'customer_name') return r.flowaccount_invoice?.customer_name ?? ''
    return ''
  }, dir))

  return (
    <>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">Unmapped invoice lines</h2>
        <DataFreshness sources={['flowaccount_invoices']} />
      </div>
      <p className="text-graphite text-sm mb-6 max-w-2xl">
        Строки FlowAccount, которые не сматчились ни с одним SKU автоматически.
        Жми <span className="text-wine-red">Map to SKU</span> и выбери в поиске.
      </p>

      {rows.length === 0 ? (
        <div className="text-graphite text-sm">All lines are mapped. 🎉</div>
      ) : (
        <div className="bg-warm-white border border-pale-stone rounded-md overflow-visible">
          <table className="w-full text-[13px]">
            <thead className="text-graphite border-b border-pale-stone bg-cream/40">
              <tr>
                <SortHeader col="number"        label="Invoice"  sort={sort} dir={dir} sp={sp} />
                <SortHeader col="issued_at"     label="Issued"   sort={sort} dir={dir} sp={sp} />
                <SortHeader col="customer_name" label="Customer" sort={sort} dir={dir} sp={sp} />
                <SortHeader col="raw_text"      label="Raw text" sort={sort} dir={dir} sp={sp} />
                <SortHeader col="qty"           label="Qty"      sort={sort} dir={dir} sp={sp} align="right" />
                <SortHeader col="amount"        label="Amount"   sort={sort} dir={dir} sp={sp} align="right" />
                <th className="text-right py-2 px-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => (
                <tr key={r.id} className="border-b border-pale-stone/40 last:border-0">
                  <td className="py-2 px-4 font-mono">{r.flowaccount_invoice?.number}</td>
                  <td className="py-2 px-4">{fmtDate(r.flowaccount_invoice?.issued_at)}</td>
                  <td className="py-2 px-4">{r.flowaccount_invoice?.customer_name}</td>
                  <td className="py-2 px-4">{r.raw_text}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{r.qty}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{r.amount ? `฿${Number(r.amount).toLocaleString()}` : '—'}</td>
                  <td className="py-2 px-4 text-right">
                    <MapLineCell lineId={r.id} defaultQuery={r.raw_text} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
