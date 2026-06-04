import { listInStock } from '@/lib/wines'
import { WineTile } from '@/components/WineTile'
import { CatalogFilters } from './CatalogFilters'
import type { WineColor } from '@/lib/types'

export const dynamic = 'force-dynamic'

type SearchParams = { color?: string; country?: string; max?: string }

const COLOR_ORDER: WineColor[] = ['red', 'white', 'rose', 'sparkling', 'orange']

export default async function CatalogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const color = (sp.color ?? '').toLowerCase()
  const country = (sp.country ?? '').toLowerCase()
  const max = sp.max ? Number(sp.max) : null

  const all = await listInStock()
  const countries = Array.from(new Set(all.map(w => w.country).filter(Boolean) as string[])).sort()

  const filtered = all.filter(w => {
    if (color && w.color !== color) return false
    if (country && (w.country ?? '').toLowerCase() !== country) return false
    if (max != null && (w.price_thb ?? Infinity) > max) return false
    return true
  })

  // Sort by color then price for a stable grid.
  filtered.sort((a, b) => {
    const ca = COLOR_ORDER.indexOf(a.color ?? 'red')
    const cb = COLOR_ORDER.indexOf(b.color ?? 'red')
    if (ca !== cb) return ca - cb
    return (a.price_thb ?? 0) - (b.price_thb ?? 0)
  })

  return (
    <div className="flex-1 flex flex-col bg-warm-white">
      <CatalogFilters countries={countries} />
      <div className="flex-1 overflow-y-auto px-6 pb-32">
        <div className="overline text-graphite mb-3">{filtered.length} wines in stock</div>
        <div className="grid grid-cols-2 gap-4">
          {filtered.map(w => <WineTile key={w.id} wine={w} />)}
        </div>
      </div>
    </div>
  )
}
