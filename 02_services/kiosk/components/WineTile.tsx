import Link from 'next/link'
import type { WineCard } from '@/lib/types'

export function WineTile({ wine }: { wine: WineCard }) {
  return (
    <Link
      href={`/wine/${wine.id}`}
      className="bg-warm-white rounded-lg border border-pale-stone p-4 flex flex-col gap-3 active:bg-cream"
    >
      <div className="aspect-[3/4] bg-cream rounded-md flex items-center justify-center overflow-hidden">
        {/* Vivino images are external. Plain <img> avoids next/image config noise here. */}
        {wine.image_url
          ? <img src={wine.image_url} alt="" className="h-full w-auto object-contain" />
          : <span className="overline text-graphite">No image</span>}
      </div>
      <div className="flex-1 min-h-0">
        <div className="font-heading font-semibold text-lg text-deep-black line-clamp-2">{wine.name}</div>
        <div className="mt-1 text-sm text-graphite">
          {[wine.country, wine.grape].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="font-heading font-bold text-xl text-deep-black">
          {wine.price_thb != null ? `฿${wine.price_thb.toLocaleString('en-US')}` : '—'}
        </div>
        {wine.vivino_rating != null && (
          <div className="overline text-amber-gold">★ {wine.vivino_rating.toFixed(1)}</div>
        )}
      </div>
    </Link>
  )
}
