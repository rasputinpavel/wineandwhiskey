import Link from 'next/link'
import { sbInventory, type SkuBreakdown } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'
import { SkuSearchBox } from '@/components/modules/inventory/SkuSearchBox'
import { DataFreshness } from '@/components/shell/DataFreshness'
import { SortHeader } from '@/components/shell/SortHeader'

export const dynamic = 'force-dynamic'

type SortKey = 'loyverse_product_code' | 'name' | 'category' | 'on_hand' | 'in_store' | 'b2b_in_transit'
const SORT_KEYS: SortKey[] = ['loyverse_product_code', 'name', 'category', 'on_hand', 'in_store', 'b2b_in_transit']
const DEFAULT_SORT: SortKey = 'name'
const DEFAULT_DIR: 'asc' | 'desc' = 'asc'

type SearchParams = {
  q?: string
  category?: string
  sort?: SortKey
  dir?: 'asc' | 'desc'
  in_stock?: string      // 'on' если галка отмечена
  _submitted?: string    // '1' маркер того, что форма submit-нута
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
  // «Только в наличии» — дефолт ON. Если форма submit-нута и галка не пришла,
  // значит пользователь её снял → показываем всё.
  const inStockOnly = sp._submitted !== '1' || sp.in_stock === 'on'

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
  if (inStockOnly) {
    req = req.or('on_hand.gt.0,in_store.gt.0,b2b_in_transit.gt.0')
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
        <form className="flex flex-wrap items-end gap-3 w-full sm:w-auto">
          <label className="flex flex-col gap-1 w-full sm:w-auto">
            <span className="overline text-graphite">Category</span>
            <select
              name="category"
              defaultValue={categoryFilter}
              className="px-2 py-1.5 border border-pale-stone bg-warm-white rounded-sm focus:outline-none focus:border-wine-red w-full sm:w-56"
            >
              <option value="">All categories ({categories.length})</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 py-1.5 cursor-pointer shrink-0" title="Скрыть SKU где все колонки = 0">
            <input
              type="checkbox"
              name="in_stock"
              defaultChecked={inStockOnly}
              className="accent-wine-red"
            />
            <span className="text-deep-black whitespace-nowrap">Только в наличии</span>
          </label>
          {/* Preserve current query + sort when applying filter */}
          {query && <input type="hidden" name="q" value={query} />}
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          {/* Маркер submit'а — позволяет отличить «дефолт» от «снял галку» */}
          <input type="hidden" name="_submitted" value="1" />
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
                <SortHeader col="loyverse_product_code" label="Code"           sort={sort} dir={dir} sp={sp} keep={['q','category','in_stock','_submitted']} firstDir="asc" />
                <SortHeader col="name"                  label="Name"           sort={sort} dir={dir} sp={sp} keep={['q','category','in_stock','_submitted']} firstDir="asc" />
                <SortHeader col="category"              label="Category"       sort={sort} dir={dir} sp={sp} keep={['q','category','in_stock','_submitted']} firstDir="asc" />
                <SortHeader col="on_hand"               label="On hand"        sort={sort} dir={dir} sp={sp} keep={['q','category','in_stock','_submitted']} align="right" />
                <SortHeader col="in_store"              label="In store"       sort={sort} dir={dir} sp={sp} keep={['q','category','in_stock','_submitted']} align="right" />
                <SortHeader col="b2b_in_transit"        label="B2B in transit" sort={sort} dir={dir} sp={sp} keep={['q','category','in_stock','_submitted']} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.sku_id} className="border-b border-pale-stone/40 last:border-0 hover:bg-cream/40">
                  <td className="py-2 px-4 font-mono text-graphite">{r.loyverse_product_code ?? '—'}</td>
                  <td className="py-2 px-4">
                    {r.loyverse_product_code ? (
                      <Link href={`/m/inventory/sku/${encodeURIComponent(r.loyverse_product_code)}`} className="hover:text-wine-red">
                        {r.name}
                      </Link>
                    ) : r.name}
                  </td>
                  <td className="py-2 px-4 text-graphite">{r.category ?? '—'}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{fmt(r.on_hand)}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{fmt(r.in_store)}</td>
                  <td className="py-2 px-4 text-right tabular-nums text-wine-red">{fmt(r.b2b_in_transit)}</td>
                </tr>
              ))}
              {rows.length === 0 && !error && (
                <tr><td colSpan={6} className="py-10 text-center text-graphite text-sm">
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

function fmt(n: number): string {
  if (!n || n === 0) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
