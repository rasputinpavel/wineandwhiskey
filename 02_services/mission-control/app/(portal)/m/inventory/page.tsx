import Link from 'next/link'
import { sbInventory, type SkuBreakdown } from '@/lib/supabase'
import { SyncBadge } from '@/components/modules/inventory/SyncBadge'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { SkuSearchBox } from '@/components/modules/inventory/SkuSearchBox'

export const dynamic = 'force-dynamic'

type SortKey = 'loyverse_product_code' | 'name' | 'on_hand' | 'in_store' | 'b2b_in_transit' | 'on_consignment'
const SORT_KEYS: SortKey[] = ['loyverse_product_code', 'name', 'on_hand', 'in_store', 'b2b_in_transit', 'on_consignment']
const DEFAULT_SORT: SortKey = 'name'
const DEFAULT_DIR: 'asc' | 'desc' = 'asc'

type SearchParams = {
  q?: string
  sort?: SortKey
  dir?: 'asc' | 'desc'
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const sort: SortKey = SORT_KEYS.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : DEFAULT_SORT
  const dir = sp.dir === 'desc' ? 'desc' : DEFAULT_DIR
  const query = (sp.q ?? '').trim()

  let req = sbInventory
    .from('v_sku_breakdown')
    .select('*')
    .order(sort, { ascending: dir === 'asc', nullsFirst: false })
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

      <SkuSearchBox defaultValue={query} sort={sort} dir={dir} />

      {error && <SchemaError error={error.message} />}

      {!error && (
        <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="text-graphite border-b border-pale-stone bg-cream/40">
              <tr>
                <SortTh col="loyverse_product_code" label="Code"           sort={sort} dir={dir} sp={sp} />
                <SortTh col="name"                  label="Name"           sort={sort} dir={dir} sp={sp} />
                <SortTh col="on_hand"               label="On hand"        sort={sort} dir={dir} sp={sp} align="right" />
                <SortTh col="in_store"              label="In store"       sort={sort} dir={dir} sp={sp} align="right" />
                <SortTh col="b2b_in_transit"        label="B2B in transit" sort={sort} dir={dir} sp={sp} align="right" />
                <SortTh col="on_consignment"        label="Consignment"    sort={sort} dir={dir} sp={sp} align="right" />
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
                  {query ? `Ничего не нашлось по "${query}".` : <>No SKUs yet — run <code className="font-mono">npm run inv:all</code>.</>}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function SortTh({
  col, label, sort, dir, sp, align = 'left',
}: {
  col: SortKey
  label: string
  sort: SortKey
  dir: 'asc' | 'desc'
  sp: SearchParams
  align?: 'left' | 'right'
}) {
  const isActive = sort === col
  // Click cycles dir on the active column; switches to asc for a fresh column.
  const nextDir: 'asc' | 'desc' = isActive ? (dir === 'asc' ? 'desc' : 'asc') : 'asc'
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (v !== undefined && v !== '' && k !== 'sort' && k !== 'dir') {
      params.set(k, String(v))
    }
  }
  params.set('sort', col)
  params.set('dir', nextDir)
  const arrow = !isActive ? ' ↕' : (dir === 'asc' ? ' ↑' : ' ↓')
  return (
    <th className={`py-2 px-4 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <Link
        href={`?${params.toString()}`}
        className={`whitespace-nowrap ${isActive ? 'text-wine-red' : 'text-graphite hover:text-deep-black'}`}
      >
        {label}<span className="opacity-60">{arrow}</span>
      </Link>
    </th>
  )
}

function fmt(n: number): string {
  if (!n || n === 0) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
