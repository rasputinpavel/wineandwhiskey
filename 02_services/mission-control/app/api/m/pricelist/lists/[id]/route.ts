import { NextResponse } from 'next/server'
import { getList, updateList, upsertEnrichment } from '@/lib/pricelist/store'
import type { PriceListDoc } from '@/lib/pricelist/types'
export const dynamic = 'force-dynamic'
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try { const l = await getList(id); return l ? NextResponse.json(l) : NextResponse.json({ error: 'not found' }, { status: 404 }) }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const doc = (await req.json()) as PriceListDoc
    await updateList(id, doc); await upsertEnrichment(doc.items)
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
