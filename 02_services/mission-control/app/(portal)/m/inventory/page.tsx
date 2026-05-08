import Link from 'next/link'
import { sbInventory, type SkuBreakdown } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { SkuSearchBox } from '@/components/modules/inventory/SkuSearchBox'
import { DataFreshness } from '@/components/shell/DataFreshness'

export const dynamic = 'force-dynamic'

type SortKey = 'loyverse_product_code' | 'name' | 'category' | 'on_hand' | 'in_store' | 'b2b_in_transit' | 'on_consignment'
const SORT_KEYS: SortKey[] = ['loyverse_product_code', 'name', 'category', 'on_hand', 'in_store', 'b2b_in_transit', 'on_consignment']
const DEFAULT_SORT: SortKey = 'name'
const DEFAULT_DIR: 'asc' | 'desc' = 'asc'

type SearchParams = {
  q?: string
  category?: string
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
  const categoryFilter = (sp.category ?? '').trim()

  // Build the query — Postgres doesn't have a great way to fetch distinct
  // categories cheaply, so we do two passes: filtered breakdown for the
  // table, plus a small all-categories scan for the dropdown.
  let req = sbInventory
    .from('v_sku_breakdown')
    .select('*')
    .order(sort, { ascending: dir === 'asc', nullsFirst: false })
  if (query) {
    req = req.or(`name.ilike.%${query}%,loyverse_product_code.ilike.%${query}%`)
  }
  if (categoryFilter) {
    req = req.eq('category', categoryFilter)
  }
  const { data, error } = await req.limit(500)
  const rows = (data ?? []) as SkuBreakdown[]

  // Category dropdown options. Pulls all distinct categories from the
  // master sku table (paginated — Supabase caps select() at 1000).
  const cats = new Set<string>()
  for (let cur = 0; ; cur += 1000) {
    const { data: cd, error: ce } = await sbInventory
      .from('sku').select('category')
      .not('category', 'is', null)
      .range(cur, cur + 999)
    if (ce || !cd?.length) break
    for (const r of cd as { category: string }[]) if (r.category) cats.add(r.category)
    if (cd.length < 1000) break
  }
  const categories = Array.from(cats).sort()

  return (
    <>
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
        <h2 className="font-heading text-xl text-deep-black">SKU Breakdown</h2>
        <DataFreshness sources={['loyverse_stock', 'flowaccount_invoices']} />
      </div>

      <SkuSearchBox defaultValue={query} sort={sort} dir={dir} />

      {/* Filters row */}
      <div className="flex items-end gap-3 mb-4 flex-wrap text-xs">
        <form className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="overline text-graphite">Category</span>
            <select
              name="category"
              defaultValue={categoryFilter}
              className="px-2 py-1.5 border border-pale-stone bg-warm-white rounded-sm focus:outline-none focus:border-wine-red w-56"
            >
              <option value="">All categories ({categories.length})</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {/* Preserve current query + sort when applying filter */}
          {query && <input type="hidden" name="q" value={query} />}
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <button className="px-3 py-1.5 bg-wine-red hover:bg-burgundy-deep text-warm-white rounded-sm">Apply</button>
        </form>
        {(categoryFilter || query) && (
          <Link href="/m/inventory" className="px-3 py-1.5 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite rounded-sm">
            Reset all
          </Link>
        )}
        <div className="text-graphite ml-auto">
          {rows.length}{rows.length === 500 ? '+ (cap)' : ''} of {/* Total catalogue size */}{categories.length} categories
        </div>
      </div>

      {error && <SchemaError error={error.message} />}

      {!error && (
        <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="text-graphite border-b border-pale-stone bg-cream/40">
              <tr>
                <SortTh col="loyverse_product_code" label="Code"           sort={sort} dir={dir} sp={sp} />
                <SortTh col="name"                  label="Name"           sort={sort} dir={dir} sp={sp} />
                <SortTh col="category"              label="Category"       sort={sort} dir={dir} sp={sp} />
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
                  <td className="py-2 px-4 text-graphite">{r.category ?? '—'}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{fmt(r.on_hand)}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{fmt(r.in_store)}</td>
                  <td className="py-2 px-4 text-right tabular-nums text-wine-red">{fmt(r.b2b_in_transit)}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{fmt(r.on_consignment)}</td>
                </tr>
              ))}
              {rows.length === 0 && !error && (
                <tr><td colSpan={7} className="py-10 text-center text-graphite text-sm">
                  {query || categoryFilter
                    ? `Ничего не нашлось по фильтрам.`
                    : <>No SKUs yet — run <code className="font-mono">npm run inv:all</code>.</>}
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
  // Preserve query + filters; sort/dir get overwritten below.
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
