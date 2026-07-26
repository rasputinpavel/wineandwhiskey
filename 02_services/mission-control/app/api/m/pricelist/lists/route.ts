import { NextResponse } from 'next/server'
import { listSaved, createList, upsertEnrichment } from '@/lib/pricelist/store'
import type { PriceListDoc } from '@/lib/pricelist/types'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json({ lists: await listSaved() }) }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
export async function POST(req: Request) {
  try {
    const doc = (await req.json()) as PriceListDoc
    const id = await createList(doc)
    await upsertEnrichment(doc.items)
    return NextResponse.json({ id })
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
