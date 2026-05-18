import Link from 'next/link'
import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { scanProductImages } from '@/lib/promo/products'
import { NewPromoFormClient } from '@/components/modules/promo/NewPromoFormClient'

export const dynamic = 'force-dynamic'

export default async function NewPromoPage() {
  const item = findItem('promo')!
  const products = await scanProductImages()

  return (
    <>
      <PaneHeader
        item={item}
        rightSlot={
          <Link href="/m/promo" className="text-xs px-3 py-1.5 border border-pale-stone hover:border-wine-red hover:text-wine-red text-graphite rounded-sm">
            ← Back
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="max-w-[880px] mx-auto px-6 py-6 space-y-4">
          <div>
            <div className="overline text-graphite">Weekly promo · brief</div>
            <h1 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 36, lineHeight: 1 }}>
              New promo
            </h1>
            <p className="text-sm text-graphite mt-1 max-w-xl">
              Capture five fields. Status starts as <em>draft</em>. Generation comes in the next phase.
            </p>
          </div>
          <NewPromoFormClient products={products} />
        </div>
      </div>
    </>
  )
}
