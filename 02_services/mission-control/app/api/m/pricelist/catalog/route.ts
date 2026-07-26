import { NextResponse } from 'next/server'
import { readCatalog } from '@/lib/pricelist/catalog'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json({ rows: await readCatalog() }) }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
