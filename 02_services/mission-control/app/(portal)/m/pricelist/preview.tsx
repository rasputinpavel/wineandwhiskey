'use client'
import { useEffect, useMemo, useState } from 'react'
import { buildPages } from '@/lib/pricelist/layout'
import { buildHtml } from '@/lib/pricelist/template'
import { qrDataUrl } from '@/lib/pricelist/qr'
import type { PriceListDoc } from '@/lib/pricelist/types'

// `availableImages` is the set of product-image slugs that exist on the server
// (public/brand/products/<slug>.png). We resolve a bottle shot by EXACT slug
// match only — no fuzzy guessing, so a card never shows the wrong bottle.
export function Preview({ doc, availableImages, onSelect }: {
  doc: PriceListDoc
  availableImages: Set<string>
  onSelect?: (id: string) => void
}) {
  const [qr, setQr] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    if (doc.settings.qrUrl) qrDataUrl(doc.settings.qrUrl).then(u => { if (alive) setQr(u) })
    else setQr(undefined)
    return () => { alive = false }
  }, [doc.settings.qrUrl])

  // Clicking a card in the (sandboxed) iframe posts its item id up here.
  useEffect(() => {
    if (!onSelect) return
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { t?: string; id?: string } | null
      if (d && d.t === 'pl-card' && d.id) onSelect(d.id)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onSelect])

  const html = useMemo(() => {
    const imageDataUrls = new Map<string, string>()
    for (const it of doc.items) {
      if (it.imageUrl) continue // explicit URL is emitted by the template directly
      if (it.imageSlug && availableImages.has(it.imageSlug)) {
        imageDataUrls.set(it.imageSlug, `/brand/products/${it.imageSlug}.png`)
      }
    }
    return buildHtml({ pages: buildPages(doc.items, doc.settings), settings: doc.settings, imageDataUrls, qrDataUrl: qr, interactive: true })
  }, [doc, availableImages, qr])

  return (
    <div className="flex-1 overflow-auto bg-neutral-100 p-4">
      <iframe title="preview" srcDoc={html} className="mx-auto block border shadow"
        style={{ width: 794, height: 1123, transform: 'scale(0.8)', transformOrigin: 'top center' }} />
    </div>
  )
}
