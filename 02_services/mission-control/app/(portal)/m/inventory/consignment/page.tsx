import Link from 'next/link'
import { sbInventory } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { DataFreshness } from '@/components/shell/DataFreshness'

export const dynamic = 'force-dynamic'

type LocationRow = { id: string; name: string }

type BalanceRow = {
  location_id: string
  sku_id: string
  qty: number
  updated_at: string
  sku: { name: string; loyverse_product_code: string | null; category: string | null } | null
}

export default async function ConsignmentPage() {
  const { data: locations, error: locErr } = await sbInventory
    .from('consignment_location')
    .select('id, name')
    .order('name')

  if (locErr) return <SchemaError error={locErr.message} />

  if (!locations || locations.length === 0) {
    return (
      <>
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
          <h2 className="font-heading text-xl text-deep-black">Consignment</h2>
          <DataFreshness sources={['loyverse_stock']} />
        </div>
        <div className="text-graphite text-sm">
          Нет точек консигнации. Когда добавим Golden Brewery — здесь появятся остатки на каждой точке.
        </div>
      </>
    )
  }

  const ids = (locations as LocationRow[]).map(l => l.id)
  const { data: balances, error: balErr } = await sbInventory
    .from('consignment_balance')
    .select('location_id, sku_id, qty, updated_at, sku(name, loyverse_product_code, category)')
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
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">Consignment</h2>
        <DataFreshness sources={['loyverse_stock']} />
      </div>

      {(locations as LocationRow[]).map(loc => {
        const items = (byLocation[loc.id] ?? [])
          .filter(r => Number(r.qty) > 0)
          .sort((a, b) => (a.sku?.name ?? '').localeCompare(b.sku?.name ?? ''))
        const totalQty = items.reduce((s, r) => s + Number(r.qty || 0), 0)
        return (
          <section key={loc.id} className="mb-10">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-heading text-base text-deep-black">{loc.name}</h3>
              <div className="text-xs text-graphite">
                {items.length} SKU · <span className="text-deep-black tabular-nums font-medium">{totalQty}</span> bottles
              </div>
            </div>

            {items.length === 0 ? (
              <div className="text-sm text-graphite">Сейчас на точке ничего не лежит.</div>
            ) : (
              <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead className="text-graphite border-b border-pale-stone bg-cream/40">
                    <tr>
                      <th className="text-left  py-2 px-4">Code</th>
                      <th className="text-left  py-2 px-4">Name</th>
                      <th className="text-left  py-2 px-4">Category</th>
                      <th className="text-right py-2 px-4">Qty</th>
                      <th className="text-left  py-2 px-4">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(r => (
                      <tr key={`${r.location_id}-${r.sku_id}`} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                        <td className="py-2 px-4 font-mono text-graphite">{r.sku?.loyverse_product_code ?? '—'}</td>
                        <td className="py-2 px-4">
                          {r.sku?.loyverse_product_code ? (
                            <Link href={`/m/inventory/sku/${r.sku.loyverse_product_code}`} className="hover:text-wine-red">
                              {r.sku?.name}
                            </Link>
                          ) : r.sku?.name}
                        </td>
                        <td className="py-2 px-4 text-graphite">{r.sku?.category ?? '—'}</td>
                        <td className="py-2 px-4 text-right tabular-nums">{Number(r.qty).toLocaleString('en-US')}</td>
                        <td className="py-2 px-4 text-graphite text-xs">{r.updated_at?.slice(0, 16).replace('T', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}
    </>
  )
}
