import Link from 'next/link'
import { sbInventory } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { SortHeader, readSortParams, cmpBy } from '@/components/shell/SortHeader'

export const dynamic = 'force-dynamic'

type LocationRow = { id: string; name: string; customer_id: string }

type BalanceRow = {
  location_id: string
  sku_id: string
  qty: number
  sku: { name: string; loyverse_product_code: string | null; category: string | null } | null
}

type SearchParams = Record<string, string | undefined>

export default async function ConsignmentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { data: locations, error: locErr } = await sbInventory
    .from('consignment_location')
    .select('id, name, customer_id')
    .order('name')

  if (locErr) return <SchemaError error={locErr.message} />

  if (!locations || locations.length === 0) {
    return (
      <>
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
          <h2 className="font-heading text-xl text-deep-black">Consignment</h2>
          <DataFreshness sources={['flowaccount_invoices']} />
        </div>
        <div className="text-graphite text-sm">
          Точки консигнации появятся здесь, как только отметишь любого клиента как Consignment в{' '}
          <Link href="/m/customers" className="text-wine-red hover:underline">списке клиентов</Link>{' '}
          (Golden Brewery — первый кандидат).
        </div>
      </>
    )
  }

  // Pull derived balances from the view (delivered − sold-and-paid).
  const ids = (locations as LocationRow[]).map(l => l.id)
  const { data: balances, error: balErr } = await sbInventory
    .from('v_consignment_balance')
    .select('location_id, sku_id, qty, sku(name, loyverse_product_code, category)')
    .in('location_id', ids)

  if (balErr) return <SchemaError error={balErr.message} />

  const rows = (balances ?? []) as unknown as BalanceRow[]
  const byLocation: Record<string, BalanceRow[]> = {}
  for (const r of rows) {
    if (!byLocation[r.location_id]) byLocation[r.location_id] = []
    byLocation[r.location_id].push(r)
  }

  return (
    <>
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">Consignment</h2>
        <DataFreshness sources={['flowaccount_invoices']} />
      </div>
      <p className="text-xs text-graphite mb-6 max-w-3xl">
        Остатки выводятся как <code className="font-mono">delivered − sold-and-paid</code>:
        delivery notes (наши, по каждой точке) минус оплаченные FA-инвойсы того же клиента.
        Чтобы добавить отгрузку — открой клиента → таб Deliveries.
      </p>

      {(() => {
        // Single sort applies to all per-location tables (they share columns).
        const { sort, dir } = readSortParams(sp, ['code','name','category','qty'] as const, 'name', '', 'asc')
        return (locations as LocationRow[]).map(loc => {
          const items = (byLocation[loc.id] ?? [])
            .filter(r => Number(r.qty) > 0)
            .sort(cmpBy(r => {
              if (sort === 'code')     return r.sku?.loyverse_product_code ?? ''
              if (sort === 'name')     return r.sku?.name ?? ''
              if (sort === 'category') return r.sku?.category ?? ''
              return Number(r.qty)
            }, dir))
          const totalQty = items.reduce((s, r) => s + Number(r.qty || 0), 0)
          return (
            <section key={loc.id} className="mb-10">
              <div className="flex items-baseline justify-between mb-3">
                <Link href={`/m/customers/${loc.customer_id}?tab=balance`} className="font-heading text-base text-deep-black hover:text-wine-red">
                  {loc.name}
                </Link>
                <div className="text-xs text-graphite">
                  {items.length} SKU · <span className="text-deep-black tabular-nums font-medium">{totalQty}</span> bottles
                  <Link href={`/m/customers/${loc.customer_id}?tab=deliveries`} className="ml-3 text-wine-red hover:underline">deliveries →</Link>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="text-sm text-graphite">Сейчас на точке ничего не лежит.</div>
              ) : (
                <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead className="text-graphite border-b border-pale-stone bg-cream/40">
                      <tr>
                        <SortHeader col="code"     label="Code"     sort={sort} dir={dir} sp={sp} firstDir="asc" />
                        <SortHeader col="name"     label="Name"     sort={sort} dir={dir} sp={sp} firstDir="asc" />
                        <SortHeader col="category" label="Category" sort={sort} dir={dir} sp={sp} firstDir="asc" />
                        <SortHeader col="qty"      label="Qty"      sort={sort} dir={dir} sp={sp} align="right" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(r => (
                        <tr key={`${r.location_id}-${r.sku_id}`} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                          <td className="py-2 px-4 font-mono text-graphite">{r.sku?.loyverse_product_code ?? '—'}</td>
                          <td className="py-2 px-4">
                            {r.sku?.loyverse_product_code ? (
                              <Link href={`/m/inventory/sku/${encodeURIComponent(r.sku.loyverse_product_code)}`} className="hover:text-wine-red">
                                {r.sku?.name}
                              </Link>
                            ) : r.sku?.name}
                          </td>
                          <td className="py-2 px-4 text-graphite">{r.sku?.category ?? '—'}</td>
                          <td className="py-2 px-4 text-right tabular-nums">{Number(r.qty).toLocaleString('en-US')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        })
      })()}
    </>
  )
}
