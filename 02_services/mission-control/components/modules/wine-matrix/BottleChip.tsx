import Link from 'next/link'
import type { ShelfItem } from '@/lib/wine-matrix/queries'

const THB = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

function qtyTone(qty: number, source: 'stock' | 'supplier'): string {
  if (source === 'supplier') return 'text-pale-stone'
  if (qty === 0)             return 'text-pale-stone'
  if (qty <= 2)              return 'text-wine-red'
  if (qty <= 6)              return 'text-amber-gold'
  return 'text-graphite'
}

export function BottleChip({ item }: { item: ShelfItem }) {
  const inStock = item.source === 'stock'
  const href = item.product_code ? `/m/inventory/sku/${encodeURIComponent(item.product_code)}` : null

  const body = (
    <div className={`relative h-full flex flex-col gap-2 p-3 rounded-md border ${
      inStock ? 'bg-warm-white border-pale-stone hover:border-wine-red' : 'bg-cream/60 border-cream'
    } transition-colors shadow-card hover:shadow-card-hover`}>
      <div className="aspect-[3/4] flex items-center justify-center bg-cream rounded-sm overflow-hidden">
        {item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image_url} alt={item.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="text-pale-stone text-xs font-heading">W&W</div>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <div className="text-[11px] leading-tight line-clamp-2 text-graphite" title={item.name}>{item.name}</div>
      </div>
      <div className="flex items-end justify-between">
        <div className={`text-lg font-heading leading-none ${qtyTone(item.qty, item.source)}`}>
          {inStock ? item.qty : '—'}
        </div>
        <div className="text-right text-[10px] leading-tight text-graphite/70">
          {item.cost_price != null && <div>cost ฿{THB.format(item.cost_price)}</div>}
          {item.retail_price != null && <div>retail ฿{THB.format(item.retail_price)}</div>}
        </div>
      </div>
      {!inStock && (
        <div className="absolute top-1.5 right-1.5 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-pale-stone/60 text-graphite">
          {item.supplier_name ? item.supplier_name.slice(0, 18) : 'Supplier'}
        </div>
      )}
    </div>
  )

  return href ? <Link href={href} className="block h-full">{body}</Link> : body
}
