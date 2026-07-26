import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { rowsToLineItems } from '@/lib/pricelist/import'
export const dynamic = 'force-dynamic'
export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'no file' }, { status: 400 })
    const wb = XLSX.read(await file.arrayBuffer())
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    return NextResponse.json(rowsToLineItems(rows))
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
