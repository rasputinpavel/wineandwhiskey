import { Suspense } from 'react'
import { supabase } from '@/lib/price/supabase'
import { catalogFreshness } from '@/lib/price/freshness'
import FilterBar from '@/components/modules/price/FilterBar'
import PriceTableClient from '@/components/modules/price/PriceTableClient'

type SearchParams = {
  q?: string
  supplier?: string
  country?: string
  grape?: string
  category?: string
  wine_type?: string
  spirit_type?: string
  page?: string
  sort?: string
  dir?: string
}

const SORTABLE = ['name', 'supplier_name', 'country', 'winery', 'year', 'price', 'vivino_rating', 'vivino_alcohol'] as const
type SortCol = typeof SORTABLE[number]

export default async function PriceCatalogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1'))
  const limit = 50
  const offset = (page - 1) * limit
  const sortCol: SortCol = (SORTABLE as readonly string[]).includes(params.sort ?? '') ? params.sort as SortCol : 'name'
  const sortAsc = params.dir !== 'desc'

  let query = supabase
    .from('wine_items')
    .select('*', { count: 'exact' })
    .order(sortCol, { ascending: sortAsc, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (params.q) query = query.ilike('name', `%${params.q}%`)
  if (params.supplier) query = query.eq('supplier_name', params.supplier)
  if (params.country) query = query.eq('country', params.country)
  if (params.grape) query = query.ilike('grape_variety', `%${params.grape}%`)
  if (params.category) query = query.eq('category', params.category)
  if (params.wine_type) query = query.eq('wine_type', params.wine_type)
  if (params.spirit_type) query = query.eq('spirit_type', params.spirit_type)

  const [itemsRes, filterRes, priceListsRes] = await Promise.all([
    query,
    supabase.rpc('get_filter_options'),
    supabase.from('price_lists').select('id, status').eq('status', 'processing'),
  ])

  const filterOptions = (filterRes.data ?? {}) as { suppliers?: string[]; countries?: string[]; grapes?: string[]; spirit_types?: string[] }
  const suppliers = filterOptions.suppliers ?? []
  const countries = filterOptions.countries ?? []
  const grapes = filterOptions.grapes ?? []
  const spiritTypes = filterOptions.spirit_types ?? []

  const rawItems = itemsRes.data ?? []
  const total = itemsRes.count ?? 0
  const processingCount = priceListsRes.data?.length ?? 0

  // Tag each item current/expired — but only where a supplier has multiple
  // catalog versions (otherwise the badge is noise: everything is "current").
  const { currentIds, versionedSuppliers } = await catalogFreshness()
  const items = rawItems.map(it => ({
    ...it,
    catalog_status: it.supplier_id && versionedSuppliers.has(it.supplier_id)
      ? (currentIds.has(it.price_list_id) ? 'current' as const : 'expired' as const)
      : null,
  }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-graphite">
          {total > 0 ? (
            <span>
              <strong className="text-deep-black font-heading font-semibold">{total.toLocaleString('ru-RU')}</strong> позиций ·{' '}
              <strong className="text-deep-black font-heading font-semibold">{suppliers.length}</strong> поставщиков
            </span>
          ) : (
            <span>Нет данных — загрузите первый прайс</span>
          )}
        </div>
        {processingCount > 0 && (
          <span className="text-xs bg-amber-gold/15 text-wine-red px-2.5 py-1 rounded-full font-medium animate-pulse">
            Обработка {processingCount} прайса...
          </span>
        )}
      </div>

      <Suspense>
        <FilterBar
          suppliers={suppliers}
          countries={countries}
          grapes={grapes}
          spiritTypes={spiritTypes}
          category={params.category ?? ''}
          wineType={params.wine_type ?? ''}
          spiritType={params.spirit_type ?? ''}
        />
      </Suspense>

      <Suspense fallback={<div className="text-center py-12 text-graphite text-sm">Загрузка...</div>}>
        <PriceTableClient items={items} total={total} page={page} limit={limit} sortCol={sortCol} sortAsc={sortAsc} />
      </Suspense>
    </div>
  )
}
