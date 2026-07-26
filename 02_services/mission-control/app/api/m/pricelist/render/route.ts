import { NextResponse } from 'next/server'
import { renderPricelist } from '@/lib/pricelist/render'
import type { PriceListDoc } from '@/lib/pricelist/types'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function POST(req: Request) {
  try {
    const doc = (await req.json()) as PriceListDoc
    const { pngs, pdf } = await renderPricelist(doc)
    return NextResponse.json({
      pdf: pdf.toString('base64'),
      pngs: pngs.map(p => p.toString('base64')),
    })
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
