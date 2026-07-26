'use client'
import { useMemo } from 'react'
import { buildPages } from '@/lib/pricelist/layout'
import { buildHtml } from '@/lib/pricelist/template'
import type { PriceListDoc } from '@/lib/pricelist/types'

export function Preview({ doc }: { doc: PriceListDoc }) {
  const html = useMemo(() => buildHtml({ pages: buildPages(doc.items, doc.settings), settings: doc.settings }), [doc])
  return (
    <div className="flex-1 overflow-auto bg-neutral-100 p-4">
      <iframe title="preview" srcDoc={html} className="mx-auto block border shadow"
        style={{ width: 794, height: 1123, transform: 'scale(0.8)', transformOrigin: 'top center' }} />
    </div>
  )
}
