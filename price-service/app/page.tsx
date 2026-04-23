import { Suspense } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import FilterBar from '@/components/FilterBar'
import PriceTableClient from '@/components/PriceTableClient'

type SearchParams = {
  q?: string
  supplier?: string
  country?: string
  grape?: string
  page?: string
  sort?: string
  dir?: string
}

const SORTABLE = ['name', 'supplier_name', 'country', 'year', 'price'] as const
type SortCol = typeof SORTABLE[number]

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1'))
  const limit = 50
  const offset = (page - 1) * limit
  const sortCol: SortCol = (SORTABLE as readonly string[]).includes(params.sort ?? '') ? params.sort as SortCol : 'name'
  const sortAsc = params.dir !== 'desc'

  // Build wine_items query
  let query = supabase
    .from('wine_items')
    .select('*', { count: 'exact' })
    .order(sortCol, { ascending: sortAsc, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (params.q) query = query.ilike('name', `%${params.q}%`)
  if (params.supplier) query = query.eq('supplier_name', params.supplier)
  if (params.country) query = query.eq('country', params.country)
  if (params.grape) query = query.ilike('grape_variety', `%${params.grape}%`)

  const [itemsRes, filterRes, priceListsRes] = await Promise.all([
    query,
    supabase.rpc('get_filter_options'),
    supabase.from('price_lists').select('id, status').eq('status', 'processing'),
  ])

  const filterOptions = (filterRes.data ?? {}) as { suppliers?: string[]; countries?: string[]; grapes?: string[] }
  const suppliers = filterOptions.suppliers ?? []
  const countries = filterOptions.countries ?? []
  const grapes = filterOptions.grapes ?? []

  const items = itemsRes.data ?? []
  const total = itemsRes.count ?? 0
  const processingCount = priceListsRes.data?.length ?? 0

  return (
    <div className="min-h-screen bg-[#f8f7f5]">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-wine-600 font-bold text-lg tracking-tight">Price Service</span>
            <span className="hidden sm:block text-gray-300">·</span>
            <span className="hidden sm:block text-sm text-gray-500">Wine &amp; Whiskey</span>
          </div>
          <div className="flex items-center gap-2">
            {processingCount > 0 && (
              <span className="text-xs bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full font-medium animate-pulse">
                Обработка {processingCount} прайса...
              </span>
            )}
            <Link
              href="/price-lists"
              className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2 rounded-lg hover:bg-gray-100 transition-colors hidden sm:block"
              title="Управление прайсами"
            >
              Прайсы
            </Link>
            <Link
              href="/upload"
              className="flex items-center gap-1.5 bg-wine-600 hover:bg-wine-700 text-white text-sm font-medium px-3.5 py-2 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Загрузить прайс</span>
              <span className="sm:hidden">Загрузить</span>
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Stats row */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {total > 0 ? (
              <span><strong className="text-gray-900">{total.toLocaleString('ru-RU')}</strong> позиций · <strong className="text-gray-900">{suppliers.length}</strong> поставщиков</span>
            ) : (
              <span>Нет данных — загрузите первый прайс</span>
            )}
          </div>
        </div>

        {/* Filters */}
        <Suspense>
          <FilterBar suppliers={suppliers} countries={countries} grapes={grapes} />
        </Suspense>

        {/* Table */}
        <Suspense fallback={<div className="text-center py-12 text-gray-400 text-sm">Загрузка...</div>}>
          <PriceTableClient items={items} total={total} page={page} limit={limit} sortCol={sortCol} sortAsc={sortAsc} />
        </Suspense>
      </main>
    </div>
  )
}

function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="POST">
      <button
        type="submit"
        className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2 rounded-lg hover:bg-gray-100 transition-colors"
        title="Выйти"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1" />
        </svg>
      </button>
    </form>
  )
}
