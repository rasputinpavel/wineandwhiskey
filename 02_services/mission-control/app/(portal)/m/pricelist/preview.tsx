'use client'
import { useEffect, useMemo, useState } from 'react'
import { buildPages } from '@/lib/pricelist/layout'
import { buildHtml } from '@/lib/pricelist/template'
import { qrDataUrl } from '@/lib/pricelist/qr'
import type { PriceListDoc } from '@/lib/pricelist/types'

// `availableImages` is the set of product-image slugs that exist on the server
// (public/brand/products/<slug>.png). We resolve a bottle shot by EXACT slug
// match only — no fuzzy guessing, so a card never shows the wrong bottle.
export function Preview({ doc, availableImages }: { doc: PriceListDoc; availableImages: Set<string> }) {
  const [qr, setQr] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    if (doc.settings.qrUrl) qrDataUrl(doc.settings.qrUrl).then(u => { if (alive) setQr(u) })
    else setQr(undefined)
    return () => { alive = false }
  }, [doc.settings.qrUrl])

  const html = useMemo(() => {
    const imageDataUrls = new Map<string, string>()
    for (const it of doc.items) {
      if (it.imageUrl) continue // explicit URL is emitted by the template directly
      if (it.imageSlug && availableImages.has(it.imageSlug)) {
        imageDataUrls.set(it.imageSlug, `/brand/products/${it.imageSlug}.png`)
      }
    }
    return buildHtml({ pages: buildPages(doc.items, doc.settings), settings: doc.settings, imageDataUrls, qrDataUrl: qr })
  }, [doc, availableImages, qr])

  return (
    <div className="flex-1 overflow-auto bg-neutral-100 p-4">
      <iframe title="preview" srcDoc={html} className="mx-auto block border shadow"
        style={{ width: 794, height: 1123, transform: 'scale(0.8)', transformOrigin: 'top center' }} />
    </div>
  )
}
