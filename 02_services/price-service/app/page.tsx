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
  category?: string
  wine_type?: string
  spirit_type?: string
  page?: string
  sort?: string
  dir?: string
}

const SORTABLE = ['name', 'supplier_name', 'country', 'winery', 'year', 'price', 'vivino_rating', 'vivino_alcohol'] as const
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

  const items = itemsRes.data ?? []
  const total = itemsRes.count ?? 0
  const processingCount = priceListsRes.data?.length ?? 0

  return (
    <div className="min-h-screen bg-warm-white">
      {/* Header */}
      <header className="bg-white border-b border-stone sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 group">
            <BrandMark />
            <div className="flex flex-col leading-none">
              <span className="font-display text-xl sm:text-2xl tracking-wide leading-none">
                <span className="text-wine-600">WINE</span>
                <span className="text-ink"> &amp; WHISKEY</span>
              </span>
              <span className="mt-1 text-[10px] tracking-[0.2em] uppercase font-semibold text-graphite">
                Price Service
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            {processingCount > 0 && (
              <span className="text-xs bg-amber/15 text-wine-700 px-2.5 py-1 rounded-full font-medium animate-pulse">
                Обработка {processingCount} прайса...
              </span>
            )}
            <Link
              href="/price-lists"
              className="text-sm text-graphite hover:text-ink px-2 py-2 rounded-lg hover:bg-warm-white transition-colors hidden sm:block"
              title="Управление прайсами"
            >
              Прайсы
            </Link>
            <Link
              href="/upload"
              className="flex items-center gap-1.5 bg-wine-600 hover:bg-wine-700 text-warm-white text-sm font-medium px-3.5 py-2 rounded-xl transition-colors"
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
          <div className="text-sm text-graphite">
            {total > 0 ? (
              <span><strong className="text-ink font-heading font-semibold">{total.toLocaleString('ru-RU')}</strong> позиций · <strong className="text-ink font-heading font-semibold">{suppliers.length}</strong> поставщиков</span>
            ) : (
              <span>Нет данных — загрузите первый прайс</span>
            )}
          </div>
        </div>

        {/* Filters */}
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

        {/* Table */}
        <Suspense fallback={<div className="text-center py-12 text-gray-400 text-sm">Загрузка...</div>}>
          <PriceTableClient items={items} total={total} page={page} limit={limit} sortCol={sortCol} sortAsc={sortAsc} />
        </Suspense>
      </main>
    </div>
  )
}

function BrandMark() {
  // Compact monogram echoing the WINE & WHISKEY wordmark
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-wine-600 text-warm-white font-display text-xl leading-none tracking-tight shrink-0"
    >
      W
    </span>
  )
}

function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="POST">
      <button
        type="submit"
        className="text-sm text-graphite hover:text-ink px-2 py-2 rounded-lg hover:bg-warm-white transition-colors"
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
