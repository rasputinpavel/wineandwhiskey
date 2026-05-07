import Link from 'next/link'
import { sbInventory, type SkuBreakdown } from '@/lib/supabase'
import { SyncBadge } from '@/components/modules/inventory/SyncBadge'
import { SchemaError } from '@/components/modules/inventory/SchemaError'

export const dynamic = 'force-dynamic'

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const query = (q ?? '').trim()

  let req = sbInventory.from('v_sku_breakdown').select('*').order('name')
  if (query) {
    req = req.or(`name.ilike.%${query}%,loyverse_product_code.ilike.%${query}%`)
  }
  const { data, error } = await req.limit(500)
  const rows = (data ?? []) as SkuBreakdown[]

  return (
    <>
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">SKU Breakdown</h2>
        <div className="flex gap-6">
          <SyncBadge source="loyverse_stock" />
          <SyncBadge source="flowaccount_invoices" />
        </div>
      </div>

      <form className="mb-6 flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search by SKU code or name…"
          className="border border-pale-stone bg-warm-white px-3 py-2 rounded-sm w-[360px] text-sm focus:outline-none focus:border-wine-red"
        />
        <button className="bg-wine-red hover:bg-burgundy-deep text-warm-white text-sm px-4 py-2 rounded-sm transition-colors">
          Search
        </button>
      </form>

      {error && <SchemaError error={error.message} />}

      {!error && (
        <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="text-graphite border-b border-pale-stone bg-cream/40">
              <tr>
                <th className="text-left  py-2 px-4">Code</th>
                <th className="text-left  py-2 px-4">Name</th>
                <th className="text-right py-2 px-4">On hand</th>
                <th className="text-right py-2 px-4">In store</th>
                <th className="text-right py-2 px-4">B2B in transit</th>
                <th className="text-right py-2 px-4">Consignment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.sku_id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                  <td className="py-2 px-4 font-mono text-graphite">{r.loyverse_product_code ?? '—'}</td>
                  <td className="py-2 px-4">
                    {r.loyverse_product_code ? (
                      <Link href={`/m/inventory/sku/${r.loyverse_product_code}`} className="hover:text-wine-red">
                        {r.name}
                      </Link>
                    ) : r.name}
                  </td>
                  <td className="py-2 px-4 text-right tabular-nums">{fmt(r.on_hand)}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{fmt(r.in_store)}</td>
                  <td className="py-2 px-4 text-right tabular-nums text-wine-red">{fmt(r.b2b_in_transit)}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{fmt(r.on_consignment)}</td>
                </tr>
              ))}
              {rows.length === 0 && !error && (
                <tr><td colSpan={6} className="py-10 text-center text-graphite text-sm">
                  No SKUs yet — run <code className="font-mono">npm run inv:all</code> to populate.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function fmt(n: number): string {
  if (!n || n === 0) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
