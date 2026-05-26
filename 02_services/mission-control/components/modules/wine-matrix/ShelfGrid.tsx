import { BottleChip } from './BottleChip'
import type { Shelf } from '@/lib/wine-matrix/queries'

export function ShelfGrid({ shelves }: { shelves: Shelf[] }) {
  if (!shelves.length) {
    return (
      <div className="rounded-md bg-warm-white border border-pale-stone p-8 text-center text-graphite text-sm">
        Нет данных. Запусти <code className="px-1 bg-cream">npm run sync:sku-wine</code> или
        проставь wine attrs вручную на странице SKU.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {shelves.map(shelf => {
        const stockCount    = shelf.items.filter(i => i.source === 'stock').length
        const bottleCount   = shelf.items.filter(i => i.source === 'stock').reduce((s, i) => s + i.qty, 0)
        const supplierCount = shelf.items.filter(i => i.source === 'supplier').length
        return (
          <section key={shelf.label} className="rounded-md bg-warm-white border border-pale-stone overflow-hidden">
            <header className="flex items-baseline justify-between gap-4 px-4 py-2.5 bg-cream/60 border-b border-pale-stone">
              <h3 className="font-heading text-base text-deep-black">{shelf.label}</h3>
              <div className="text-[11px] text-graphite/80 tabular-nums">
                {stockCount} SKU · {bottleCount} bottles
                {supplierCount > 0 && <span className="text-pale-stone"> · +{supplierCount} supplier</span>}
              </div>
            </header>
            <div className="p-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {shelf.items.map(item => (
                <BottleChip key={item.key} item={item} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
