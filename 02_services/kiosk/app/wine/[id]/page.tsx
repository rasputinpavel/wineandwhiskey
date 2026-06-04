import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getById } from '@/lib/wines'

export const dynamic = 'force-dynamic'

export default async function WinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const wine = await getById(id)
  if (!wine) return notFound()

  return (
    <div className="flex-1 flex flex-col bg-warm-white">
      <div className="px-6 pt-6 pb-3 border-b border-pale-stone flex items-center justify-between">
        <Link href="/catalog" className="overline text-graphite active:text-deep-black">← Back</Link>
        <div className="overline text-graphite">{wine.qty} in stock</div>
      </div>

      <div className="flex-1 overflow-y-auto pb-32">
        <div className="px-6 pt-6">
          <div className="aspect-[3/4] max-h-[520px] bg-cream rounded-lg flex items-center justify-center overflow-hidden mb-6">
            {wine.image_url
              ? <img src={wine.image_url} alt="" className="h-full w-auto object-contain" />
              : <span className="overline text-graphite">No image</span>}
          </div>

          <div className="overline text-graphite">{wine.country ?? '—'} {wine.color ? `· ${wine.color}` : ''}</div>
          <h1 className="font-heading font-bold text-4xl text-deep-black leading-tight mt-2">{wine.name}</h1>
          {wine.winery && <div className="text-xl text-graphite mt-1">{wine.winery}</div>}

          <div className="flex items-baseline gap-6 mt-4">
            <div className="font-display text-5xl text-wine-red tracking-display">
              {wine.price_thb != null ? `฿${wine.price_thb.toLocaleString('en-US')}` : '—'}
            </div>
            {wine.vivino_rating != null && (
              <div className="font-heading text-2xl text-amber-gold">★ {wine.vivino_rating.toFixed(1)}</div>
            )}
          </div>

          <Spec label="Grape"   value={wine.grape} />
          <Spec label="Body"    value={wine.body} />
          <Spec label="Pairs with" value={wine.food_pairings.length ? wine.food_pairings.join(', ') : null} />

          {wine.description && (
            <div className="mt-6">
              <div className="overline text-graphite mb-2">About</div>
              <p className="text-lg text-deep-black leading-relaxed">{wine.description}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Spec({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="mt-4 flex">
      <div className="overline text-graphite w-32 pt-1">{label}</div>
      <div className="flex-1 text-lg text-deep-black">{value}</div>
    </div>
  )
}
